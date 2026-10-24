import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createUiTranslation } from '@davidniessen/doctopus-contracts';
import { UiContext } from '../apps/reader/src/ui-translation.js';
import { AuthField } from '../apps/reader/src/components/AuthField.js';
import { RelayControls } from '../apps/reader/src/components/RelayControls.js';
import {
  loadRelayPolicy,
  RelayError,
} from '../apps/reader/src/relay-transport.js';
import {
  requestOAuthToken,
  OAuthPopupError,
} from '../apps/reader/src/oauth-popup.js';
import {
  popupErrorText,
  relayErrorText,
} from '../apps/reader/src/auth-messages.js';

const ui = createUiTranslation('de-DE', {
  messages: {
    de: {
      'auth.credentialLabel': 'Zugangsdaten {name}',
      'auth.publicClient': 'Öffentlicher OAuth-Client',
      'auth.clientIdLabel': 'Client-ID für {name}',
      'auth.scopesLabel': 'Bereiche für {name}',
      'auth.redirectLabel': 'Weiterleitung für {name}',
      'auth.authorizeLabel': '{name} autorisieren',
      'auth.expiry': '{time} gültig',
      'auth.popupBlocked': 'Popup blockiert.',
      'relay.source': 'Transport wählen',
      'relay.transport': 'Anfragetransport',
      'relay.server': 'Dokumentationsserver',
      'relay.retry': 'Erneut prüfen',
      'relay.signIn': 'Anmelden.',
      'relay.denied': 'Zugriff abgelehnt.',
      'relay.busy': 'Bitte später erneut versuchen.',
      'relay.failed': 'Anfrage fehlgeschlagen.',
    },
  },
});
const render = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(UiContext.Provider, { value: ui }, element),
  );
const noop = () => {};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('renders translated public-client controls with escaped scheme names and literal registration values', () => {
  const html = render(
    createElement(AuthField, {
      name: '<scheme>',
      scheme: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://provider.example/authorize',
            tokenUrl: 'https://provider.example/token',
          },
        },
      },
      credential: '',
      onChange: noop,
      scopes: ['projects:read'],
      redirectUri: 'https://docs.example/oauth/callback/',
      client: {
        clientId: 'public-browser-client',
        issuer: 'https://provider.example',
      },
      server: 'https://api.example',
      credentialExpiresAt: Date.UTC(2027, 0, 1),
    }),
  );
  for (const text of [
    'Zugangsdaten &lt;scheme&gt;',
    'Öffentlicher OAuth-Client',
    'Client-ID für &lt;scheme&gt;',
    'Bereiche für &lt;scheme&gt;',
    'Weiterleitung für &lt;scheme&gt;',
    'value="public-browser-client"',
    'value="projects:read"',
    'value="https://docs.example/oauth/callback/"',
    'gültig',
    'never enter a client secret.',
  ])
    expect(html).toContain(text);
  expect(html).not.toContain('<scheme>');
  expect(html).toContain('dateTime="2027-01-01T00:00:00.000Z"');
});
it('localizes transport choices and retry controls without changing protocol option values', () => {
  const html = render(
    createElement(RelayControls, {
      relay: {
        enabled: true,
        policy: undefined,
        error: relayErrorText('denied', ui.text),
        checking: false,
        select: noop,
      },
      busy: false,
      onChange: noop,
    }),
  );
  for (const text of [
    'Transport wählen',
    'aria-label="Anfragetransport"',
    'value="browser"',
    'value="relay"',
    'Dokumentationsserver',
    'Zugriff abgelehnt.',
    'Erneut prüfen',
  ])
    expect(html).toContain(text);
  expect(html).toContain(
    'Your API credentials and request payload pass through this',
  );
});
it.each([
  [401, 'signIn', 'Anmelden.'],
  [403, 'denied', 'Zugriff abgelehnt.'],
  [429, 'busy', 'Bitte später erneut versuchen.'],
  [503, 'failed', 'Anfrage fehlgeschlagen.'],
] as const)(
  'localizes controlled HTTP %i relay failures without reflecting server bodies or retrying',
  async (status, code, translated) => {
    const fetch = vi.fn(async () =>
      Response.json({ error: 'private-upstream-marker' }, { status }),
    );
    vi.stubGlobal('fetch', fetch);
    const error = await loadRelayPolicy(
      '/api/projects/fixture/relay',
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RelayError);
    expect((error as RelayError).code).toBe(code);
    expect(relayErrorText((error as RelayError).code, ui.text)).toBe(
      translated,
    );
    expect((error as Error).message).not.toContain('private-upstream-marker');
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it('maps an actual blocked popup to localized feedback while retaining the English diagnostic', async () => {
  vi.stubGlobal('location', { origin: 'https://docs.example' });
  const open = vi.fn(() => null);
  vi.stubGlobal('window', { open });
  const error = await requestOAuthToken(
    {
      clientId: 'public-client',
      issuer: 'https://provider.example',
      authorizationUrl: 'https://provider.example/authorize',
      tokenUrl: 'https://provider.example/token',
      redirectUri: 'https://docs.example/oauth/callback/',
      scopes: [],
    },
    new AbortController().signal,
  ).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(OAuthPopupError);
  expect((error as OAuthPopupError).code).toBe('blocked');
  expect(popupErrorText((error as OAuthPopupError).code, ui.text)).toBe(
    'Popup blockiert.',
  );
  expect((error as Error).message).toBe(
    'Popup blocked. Allow popups for this documentation site.',
  );
  expect(open).toHaveBeenCalledTimes(1);
});
