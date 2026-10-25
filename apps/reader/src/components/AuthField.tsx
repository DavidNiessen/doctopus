import { useContext, useEffect, useRef, useState } from 'react';
import type { SecurityScheme } from '@davidniessen/doctopus-contracts';
import { requestOAuthToken, OAuthPopupError } from '../oauth-popup.js';
import type { OAuthPopupErrorCode } from '../oauth-popup.js';
import { UiContext } from '../ui-translation.js';
import { popupErrorText } from '../auth-messages.js';
import { resolveOAuthEndpoint } from '@davidniessen/doctopus-explorer';

export function AuthField({
  name,
  scheme,
  credential,
  onChange,
  scopes,
  redirectUri,
  client,
  server,
  credentialExpiresAt,
  mockOnly = false,
  required = false,
}: {
  name: string;
  scheme: SecurityScheme | undefined;
  credential: string;
  onChange: (value: string, expiresAt?: number) => void;
  credentialExpiresAt?: number | undefined;
  scopes: string[];
  redirectUri: string;
  client?: { clientId: string; issuer: string } | undefined;
  server: string;
  mockOnly?: boolean;
  required?: boolean;
}) {
  const ui = useContext(UiContext),
    t = ui.text;
  const flow =
    !mockOnly &&
    scheme?.type === 'oauth2' &&
    scheme.flows?.authorizationCode &&
    typeof scheme.flows.authorizationCode === 'object'
      ? (scheme.flows.authorizationCode as Record<string, unknown>)
      : undefined;
  const [clientId, setClientId] = useState(client?.clientId ?? '');
  const [issuer, setIssuer] = useState(client?.issuer ?? '');
  const [scopeText, setScopeText] = useState(scopes.join(' '));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<
      { code: OAuthPopupErrorCode | 'failed' } | { text: string }
    >(),
    [status, setStatus] = useState<'' | 'expired' | 'received' | 'cleared'>('');
  const [expiresAt, setExpiresAt] = useState<number | undefined>(
    credentialExpiresAt,
  );
  const pending = useRef<AbortController | null>(null),
    token = useRef<string | undefined>(
      credentialExpiresAt ? credential : undefined,
    ),
    mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (token.current && token.current !== credential) {
      const expired =
        !credential && expiresAt !== undefined && expiresAt <= Date.now();
      token.current = undefined;
      setExpiresAt(undefined);
      setStatus(expired ? 'expired' : '');
    }
  }, [credential]);
  useEffect(() => {
    if (credentialExpiresAt && credential) {
      token.current = credential;
      setExpiresAt(credentialExpiresAt);
    } else if (!credential) {
      token.current = undefined;
      setExpiresAt(undefined);
    }
  }, [credential, credentialExpiresAt]);
  useEffect(() => {
    if (!expiresAt || !credential || token.current !== credential) return;
    let timeout: ReturnType<typeof setTimeout>;
    const check = () => {
      if (token.current !== credential) return;
      if (Date.now() >= expiresAt) {
        token.current = undefined;
        setExpiresAt(undefined);
        onChange('');
        setStatus('expired');
      } else
        timeout = setTimeout(
          check,
          Math.min(expiresAt - Date.now(), 2_147_483_647),
        );
    };
    check();
    return () => clearTimeout(timeout);
  }, [expiresAt, credential, onChange]);
  async function authorize() {
    if (
      !flow ||
      typeof flow.authorizationUrl !== 'string' ||
      typeof flow.tokenUrl !== 'string'
    )
      return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(undefined);
    setStatus('');
    try {
      const result = await requestOAuthToken(
        {
          clientId,
          issuer,
          authorizationUrl: resolveOAuthEndpoint(flow.authorizationUrl, server),
          tokenUrl: resolveOAuthEndpoint(flow.tokenUrl, server),
          redirectUri,
          scopes: scopeText.split(/\s+/).filter(Boolean),
          allowLoopbackHttp:
            location.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname),
        },
        controller.signal,
      );
      if (!mounted.current || controller.signal.aborted) return;
      token.current = result.accessToken;
      setExpiresAt(result.expiresAt);
      onChange(result.accessToken, result.expiresAt);
      setStatus('received');
    } catch (error) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? { code: 'cancelled' }
            : error instanceof OAuthPopupError
              ? { code: error.code }
              : error instanceof Error
                ? { text: error.message }
                : { code: 'failed' },
        );
    } finally {
      if (mounted.current) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }
  return (
    <div className="auth-field">
      <label className="auth-primary-field request-form-field">
        <span className="request-field-meta">
          <span className="request-field-heading">
            <code>
              {scheme?.type === 'http' ||
              scheme?.type === 'oauth2' ||
              scheme?.type === 'openIdConnect'
                ? 'Authorization'
                : (scheme?.name ?? name)}
            </code>
            <span className="request-type-badge">
              string{scheme?.scheme ? `<${scheme.scheme}>` : ''}
            </span>
            {required && (
              <span className="request-required-badge">
                {t('schema.required')}
              </span>
            )}
          </span>
          <span className="request-field-description">
            {scheme?.description ??
              (scheme?.type === 'http' && scheme.scheme === 'bearer'
                ? 'Bearer authentication token.'
                : name)}
          </span>
        </span>
        <span className="auth-credential-control">
          {scheme?.scheme === 'bearer' && (
            <span className="auth-credential-prefix">Bearer</span>
          )}
          <input
            ref={input}
            type="password"
            autoComplete="off"
            aria-label={t('auth.credentialLabel', { name })}
            disabled={busy}
            value={credential}
            onChange={(event) => {
              setError(undefined);
              if (event.target.value !== credential) {
                token.current = undefined;
                setExpiresAt(undefined);
                setStatus('');
              }
              onChange(event.target.value);
            }}
            placeholder={
              scheme?.scheme === 'basic'
                ? t('auth.basicPlaceholder')
                : t('auth.tokenPlaceholder')
            }
          />
        </span>
      </label>
      {credential && (
        <button
          type="button"
          className="auth-action"
          onClick={() => {
            pending.current?.abort();
            token.current = undefined;
            setExpiresAt(undefined);
            setStatus('cleared');
            onChange('');
            input.current?.focus();
          }}
          aria-label={t('auth.clearLabel', { name })}
        >
          {t('auth.clear')}
        </button>
      )}
      {flow && (
        <>
          <details className="oauth-settings" open={!client}>
            <summary>{t('auth.publicClient')}</summary>
            <p>{t('auth.clientHelp')}</p>
            <label>
              {t('auth.clientId')}
              <input
                aria-label={t('auth.clientIdLabel', { name })}
                value={clientId}
                disabled={busy}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              {t('auth.issuer')}
              <input
                aria-label={t('auth.issuerLabel', { name })}
                value={issuer}
                disabled={busy}
                onChange={(event) => setIssuer(event.target.value)}
                type="url"
                autoComplete="off"
              />
            </label>
            <label>
              {t('auth.scopes')}
              <input
                aria-label={t('auth.scopesLabel', { name })}
                value={scopeText}
                disabled={busy}
                onChange={(event) => setScopeText(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              {t('auth.redirect')}
              <input
                aria-label={t('auth.redirectLabel', { name })}
                readOnly
                value={redirectUri}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          </details>
          <button
            type="button"
            className="auth-action"
            disabled={busy || !clientId || !issuer || !redirectUri}
            onClick={() => {
              void authorize();
            }}
            aria-label={t('auth.authorizeLabel', { name })}
          >
            {t(busy ? 'auth.waiting' : 'auth.authorize')}
          </button>
          {busy && (
            <button
              type="button"
              className="auth-action"
              onClick={() => pending.current?.abort()}
              aria-label={t('auth.cancelLabel', { name })}
            >
              {t('auth.cancel')}
            </button>
          )}
        </>
      )}
      {expiresAt && (
        <p>
          <time dateTime={new Date(expiresAt).toISOString()}>
            {t('auth.expiry', {
              time: new Date(expiresAt).toLocaleTimeString(ui.locale),
            })}
          </time>
        </p>
      )}
      {status && (
        <p role="status">
          {t(
            (
              {
                expired: 'auth.expired',
                received: 'auth.received',
                cleared: 'auth.cleared',
              } as const
            )[status],
          )}
        </p>
      )}
      {error && (
        <p role="alert">
          {'code' in error ? popupErrorText(error.code, t) : error.text}
        </p>
      )}
    </div>
  );
}
