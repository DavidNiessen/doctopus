import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { join, resolve } from 'node:path';

export const proxyImage =
  'caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f';

/** Run the shipped proxy template against an owned installation with production HTTPS settings. */
export async function verifyServerProxy(source) {
  assert.match(source.project, /^doctopus-runtime-[a-f0-9]{16}$/);
  assert.match(source.image, /^sha256:[a-f0-9]{64}$/);
  const { docker, compose, environment } = source;
  const name = source.project + '-tls';
  const label = `dev.niessen.doctopus.tls-fixture=${name}`;
  const frontend = source.project + '_frontend';
  const original = {
    PUBLIC_URL: environment.PUBLIC_URL,
    INSECURE_DEVELOPMENT: environment.INSECURE_DEVELOPMENT,
  };
  const ownedContainers = () =>
    docker([
      'ps',
      '--all',
      '--quiet',
      '--no-trunc',
      '--filter',
      'label=' + label,
    ]);
  const replaceServer = async () => {
    // Remove the owned stopped service before replacement to bound VFS storage use.
    await compose('stop', '--timeout', '35', 'docs');
    await compose('rm', '--force', 'docs');
    await compose(
      'up',
      '--detach',
      '--no-deps',
      '--no-build',
      '--pull',
      'never',
      '--wait',
      '--wait-timeout',
      '60',
      'docs',
    );
  };
  let owned = false,
    changed = false,
    report,
    failure,
    tlsDirectory;
  try {
    source.step('production TLS proxy preflight');
    assert.equal(await ownedContainers(), '');
    assert.equal(
      await docker([
        'network',
        'inspect',
        source.project + '_backend',
        '--format',
        '{{.Internal}}',
      ]),
      'true',
      'The database fixture network must be private.',
    );
    const image = await docker([
      'image',
      'inspect',
      proxyImage,
      '--format',
      '{{.Id}}',
    ]);
    assert.match(image, /^sha256:[a-f0-9]{64}$/);
    const template = await readFile(resolve('deploy/Caddyfile'), 'utf8');
    tlsDirectory = await mkdtemp(join(source.root, 'tls-'));
    const configuration = join(tlsDirectory, 'Caddyfile');
    await writeFile(
      configuration,
      '{\n  local_certs\n  skip_install_trust\n  admin off\n  auto_https disable_redirects\n}\n\n' +
        template,
      { mode: 0o644, flag: 'wx' },
    );
    owned = true;
    const proxy = await docker([
      'create',
      '--name',
      name,
      '--label',
      label,
      '--network',
      frontend,
      '--publish',
      '127.0.0.1::8443',
      '--user',
      '1000:1000',
      '--read-only',
      '--cap-drop',
      'ALL',
      // The official binary carries this file capability, even on port 8443.
      '--cap-add',
      'NET_BIND_SERVICE',
      '--security-opt',
      'no-new-privileges:true',
      '--memory',
      '128m',
      '--cpus',
      '1',
      '--pids-limit',
      '64',
      '--tmpfs',
      '/data:rw,noexec,nosuid,size=16m,uid=1000,gid=1000',
      '--tmpfs',
      '/config:rw,noexec,nosuid,size=4m,uid=1000,gid=1000',
      '--env',
      'DOCS_HOST=https://localhost:8443',
      '--entrypoint',
      '/bin/sh',
      '--mount',
      `type=bind,src=${configuration},dst=/etc/caddy/Caddyfile,readonly`,
      proxyImage,
      '-c',
      // Keep the inherited egress proxy; only the local Compose service bypasses it.
      'export NO_PROXY="${NO_PROXY:+$NO_PROXY,}docs"; export no_proxy="${no_proxy:+$no_proxy,}docs"; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile',
    ]);
    assert.match(proxy, /^[a-f0-9]{64}$/);
    await docker(['start', proxy]);
    assert.equal(
      await docker(['inspect', '--format', '{{.Image}}', proxy]),
      image,
    );
    assert.equal(await docker(['exec', proxy, 'id', '-u']), '1000');
    const host = JSON.parse(
      await docker(['inspect', '--format', '{{json .HostConfig}}', proxy]),
    );
    assert.equal(host.ReadonlyRootfs, true);
    assert.deepEqual(host.CapDrop, ['ALL']);
    assert.deepEqual(
      host.CapAdd.map((value) => value.replace(/^CAP_/, '')),
      ['NET_BIND_SERVICE'],
    );
    assert(host.SecurityOpt.includes('no-new-privileges:true'));
    assert(
      Object.values(host.PortBindings)
        .flat()
        .every((binding) => binding.HostIp === '127.0.0.1'),
    );
    assert.match(
      await docker(['exec', proxy, 'caddy', 'version']),
      /^v2\.11\.7\b/,
    );
    const address = await docker(['port', proxy, '8443/tcp']);
    assert.match(address, /^127\.0\.0\.1:[1-9]\d*$/);
    const port = Number(address.split(':')[1]);
    const origin = `https://localhost:${port}`;
    let ca;
    await source.waitFor(async () => {
      try {
        ca = await docker([
          'exec',
          proxy,
          'cat',
          '/data/caddy/pki/authorities/local/root.crt',
        ]);
        return ca.includes('-----BEGIN CERTIFICATE-----');
      } catch {
        return false;
      }
    }, 'fixture TLS authority');

    environment.PUBLIC_URL = origin;
    environment.INSECURE_DEVELOPMENT = 'false';
    changed = true;
    await replaceServer();
    const server = await compose('ps', '--quiet', 'docs');
    assert.equal(
      await docker(['inspect', '--format', '{{.Image}}', server]),
      source.image,
    );
    const networks = async (container) =>
      Object.keys(
        JSON.parse(
          await docker([
            'inspect',
            '--format',
            '{{json .NetworkSettings.Networks}}',
            container,
          ]),
        ),
      ).sort();
    assert.deepEqual(
      await networks(server),
      [source.project + '_backend', frontend].sort(),
    );
    assert.deepEqual(await networks(proxy), [frontend]);
    const request = (path, headers = {}, method = 'GET', trust = true) =>
      new Promise((resolve, reject) => {
        const pending = httpsRequest(
          {
            hostname: '127.0.0.1',
            port,
            servername: 'localhost',
            path,
            method,
            headers: { host: `localhost:${port}`, ...headers },
            ...(trust ? { ca } : {}),
            rejectUnauthorized: true,
            agent: false,
            signal: AbortSignal.timeout(10000),
          },
          (response) => {
            const chunks = [];
            let size = 0;
            const protocol = response.socket.getProtocol();
            const fingerprint =
              response.socket.getPeerCertificate().fingerprint256;
            if (!response.socket.authorized) {
              response.destroy();
              reject(new Error('The fixture TLS peer was not authorized.'));
              return;
            }
            response.on('data', (chunk) => {
              size += chunk.length;
              if (size > 10 * 1024 * 1024)
                pending.destroy(
                  new Error('Proxy fixture response exceeded its limit.'),
                );
              else chunks.push(chunk);
            });
            response.once('error', reject);
            response.once('end', () =>
              resolve({
                status: response.statusCode,
                headers: response.headers,
                text: Buffer.concat(chunks).toString('utf8'),
                protocol,
                fingerprint,
              }),
            );
          },
        );
        pending.once('error', reject);
        pending.end();
      });
    let readinessFailure = 'No HTTPS readiness response received.';
    await source
      .waitFor(async () => {
        try {
          const response = await request('/health/ready');
          readinessFailure = `HTTP ${response.status}`;
          return response.status === 200;
        } catch (error) {
          readinessFailure = String(error.code ?? error.message).slice(0, 1024);
          return false;
        }
      }, 'verified HTTPS readiness')
      .catch((error) => {
        throw new Error(
          `Verified HTTPS readiness failed: ${source.sanitize(readinessFailure)}`,
          { cause: error },
        );
      });
    source.step('verified HTTPS private-content and session checks');
    await assert.rejects(request('/health/ready', {}, 'GET', false), (error) =>
      [
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
      ].includes(error.code),
    );
    const signedIn = await request(
      '/auth/token',
      { authorization: `Bearer ${source.rootToken}` },
      'POST',
    );
    assert.equal(signedIn.status, 200);
    assert.match(signedIn.protocol, /^TLSv1\.[23]$/);
    const setCookie = signedIn.headers['set-cookie'];
    assert.equal(setCookie?.length, 1);
    for (const flag of [
      /; Secure\b/i,
      /; HttpOnly\b/i,
      /; SameSite=Lax\b/i,
      /; Path=\//i,
    ])
      assert.match(setCookie[0], flag);
    const cookie = setCookie[0].split(';')[0];
    source.secretValues.push(cookie, cookie.slice('docs_session='.length));
    for (const path of source.paths) {
      const allowed = await request(source.privateRoot + path, { cookie });
      assert.equal(allowed.status, 200, path);
      assert(allowed.headers['cache-control']?.includes('no-store'));
      assert.equal(allowed.headers['x-content-type-options'], 'nosniff');
      assert.equal(
        allowed.headers['strict-transport-security'],
        'max-age=31536000',
      );
      if (!path) assert.equal(allowed.text, source.expected);
      const denied = await request(source.privateRoot + path);
      assert.equal(denied.status, 401, path);
      assert(!denied.text.includes(source.privateMarker));
    }
    const forged = {
      cookie,
      origin: 'https://attacker.invalid',
      'x-forwarded-host': 'attacker.invalid',
      'x-forwarded-proto': 'http',
      'x-forwarded-for': '203.0.113.42',
    };
    assert.equal((await request('/auth/logout', forged, 'POST')).status, 403);
    assert.equal(
      (await request('/auth/logout', { cookie }, 'POST')).status,
      403,
    );
    assert.equal(
      (await request(source.privateRoot, { cookie })).text,
      source.expected,
    );
    const loggedOut = await request('/auth/logout', { cookie, origin }, 'POST');
    assert.equal(loggedOut.status, 200);
    const revoked = await request(source.privateRoot, { cookie });
    assert.equal(revoked.status, 401);
    assert(!revoked.text.includes(source.privateMarker));
    report = {
      serverImage: source.image,
      artifactId: source.artifactId,
      proxyImage,
      resolvedProxyImage: image,
      templateSha256: createHash('sha256').update(template).digest('hex'),
      proxyCapabilities: ['NET_BIND_SERVICE'],
      tlsVersion: signedIn.protocol,
      certificateFingerprint: signedIn.fingerprint,
      privateFiles: source.paths.length,
      checks: [
        'shipped-caddy-template-with-verified-private-ca',
        'untrusted-certificate-authority-rejected',
        'production-secure-httponly-samesite-session',
        'private-html-data-search-assets-and-cache-denial-through-tls',
        'cross-origin-and-missing-origin-cookie-mutations-rejected',
        'forwarded-header-spoofing-cannot-authorize-a-mutation',
        'same-origin-logout-revokes-the-session',
        'owned-networks-private-database-and-non-root-read-only-proxy',
      ],
    };
  } catch (error) {
    failure = error;
    if (owned) {
      try {
        for (const container of (await ownedContainers())
          .split('\n')
          .filter(Boolean)) {
          assert.match(container, /^[a-f0-9]{64}$/);
          assert.equal(
            await docker(['inspect', '--format', '{{.Name}}', container]),
            '/' + name,
          );
          console.error(
            source.sanitize(
              await docker(['logs', '--tail', '20', container], undefined, {
                includeStderr: true,
              }),
            ),
          );
        }
      } catch {
        console.error('TLS proxy fixture logs were unavailable.');
      }
    }
  } finally {
    const failures = [];
    if (owned) {
      try {
        const containers = (await ownedContainers())
          .split('\n')
          .filter(Boolean);
        for (const container of containers) {
          assert.match(container, /^[a-f0-9]{64}$/);
          assert.equal(
            await docker(['inspect', '--format', '{{.Name}}', container]),
            '/' + name,
          );
          await docker(['rm', '--force', '--volumes', container]);
        }
        assert.equal(await ownedContainers(), '');
      } catch (error) {
        failures.push(error);
      }
    }
    Object.assign(environment, original);
    if (changed) {
      try {
        await replaceServer();
        const address = await compose('port', 'docs', '8080');
        assert.match(address, /^127\.0\.0\.1:[1-9]\d*$/);
        if (report) report.directBase = 'http://' + address;
      } catch (error) {
        failures.push(error);
      }
    }
    if (tlsDirectory && failures.length === 0) {
      try {
        await rm(tlsDirectory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...failures],
        'TLS acceptance or owned cleanup failed.',
      );
  }
  if (failure) throw failure;
  assert(report);
  return { ...report, cleanupVerified: true };
}
