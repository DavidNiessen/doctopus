import {
  createPkceTransaction,
  exchangePkceCode,
} from '@davidniessen/doctopus-explorer';
import type {
  OAuthClient,
  OAuthAccessToken,
  PkceTransaction,
} from '@davidniessen/doctopus-explorer';
const popupMessages = {
  cancelled: 'Authorization cancelled.',
  closed: 'Authorization window closed.',
  timeout: 'Authorization timed out after five minutes.',
  provider: 'Authorization window could not open the provider.',
  callback: 'OAuth callback must use this documentation origin.',
  blocked: 'Popup blocked. Allow popups for this documentation site.',
} as const;
export type OAuthPopupErrorCode = keyof typeof popupMessages;
export class OAuthPopupError extends Error {
  constructor(readonly code: OAuthPopupErrorCode) {
    super(popupMessages[code]);
  }
}

function receiveCallback(
  popup: Window,
  transaction: PkceTransaction,
  signal: AbortSignal,
): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let closedAt: number | undefined;
    const cleanup = () => {
      clearInterval(closed);
      clearTimeout(timeout);
      window.removeEventListener('message', message);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new OAuthPopupError('cancelled'));
    const message = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== location.origin ||
        event.source !== popup ||
        !event.data ||
        typeof event.data !== 'object'
      )
        return;
      const data = event.data as Record<string, unknown>;
      if (
        data.type !== 'doctopus:oauth-callback' ||
        typeof data.query !== 'string' ||
        data.query.length > 16_384
      )
        return;
      const parameters = new URLSearchParams(data.query);
      if (
        parameters.getAll('state').length !== 1 ||
        parameters.get('state') !== transaction.state
      )
        return;
      cleanup();
      resolve(parameters);
    };
    const closed = setInterval(() => {
      if (!popup.closed) return;
      closedAt ??= Date.now();
      if (Date.now() - closedAt >= 500) fail(new OAuthPopupError('closed'));
    }, 250);
    const timeout = setTimeout(
      () => fail(new OAuthPopupError('timeout')),
      Math.max(0, transaction.expiresAt - Date.now()),
    );
    window.addEventListener('message', message);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      popup.location.replace(transaction.authorizationUrl);
    } catch {
      fail(new OAuthPopupError('provider'));
    }
  });
}
export async function requestOAuthToken(
  client: OAuthClient,
  signal: AbortSignal,
): Promise<OAuthAccessToken> {
  if (new URL(client.redirectUri).origin !== location.origin)
    throw new OAuthPopupError('callback');
  if (signal.aborted) throw new OAuthPopupError('cancelled');
  const popup = window.open(
    'about:blank',
    '_blank',
    'popup,width=520,height=720',
  );
  if (!popup) throw new OAuthPopupError('blocked');
  try {
    const transaction = await createPkceTransaction(client);
    const callback = await receiveCallback(popup, transaction, signal);
    return await exchangePkceCode(transaction, callback, { signal });
  } finally {
    popup.close();
  }
}
