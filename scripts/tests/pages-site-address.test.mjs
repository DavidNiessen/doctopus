import assert from 'node:assert/strict';
import test from 'node:test';
import { pagesSiteAddress } from '../lib/pages-site-address.mjs';

test('custom domains compile assets and canonical links at the domain root', () => {
  const address = pagesSiteAddress({ customDomain: 'doctopus.niessen.dev\n' });
  assert.equal(address.origin, 'https://doctopus.niessen.dev');
  assert.equal(address.pathname, '/');
  assert.equal(
    new URL('assets/reader.css', address).href,
    'https://doctopus.niessen.dev/assets/reader.css',
  );
});

test('repositories without a CNAME retain project and user Pages paths', () => {
  assert.equal(
    pagesSiteAddress({ repository: 'DavidNiessen/doctopus' }).pathname,
    '/doctopus',
  );
  assert.equal(
    pagesSiteAddress({ repository: 'DavidNiessen/DavidNiessen.github.io' })
      .pathname,
    '/',
  );
});

test('explicit HTTPS preview URLs override the custom domain', () => {
  assert.equal(
    pagesSiteAddress({
      customDomain: 'doctopus.niessen.dev',
      siteUrl: 'https://docs.example.com/preview',
    }).href,
    'https://docs.example.com/preview',
  );
});

test('CNAME and URL configuration reject malformed or unsafe destinations', () => {
  for (const customDomain of [
    '',
    'https://docs.example.com',
    'docs.example.com/path',
    'docs.example.com:443',
    'user@docs.example.com',
    'docs.example.com\nother.example.com',
  ])
    assert.throws(() => pagesSiteAddress({ customDomain }), /CNAME/);
  for (const siteUrl of [
    'http://docs.example.com',
    'https://user:secret@docs.example.com',
    'https://docs.example.com?x=1',
    'https://docs.example.com#fragment',
  ])
    assert.throws(() => pagesSiteAddress({ siteUrl }), /PAGES_SITE_URL/);
});
