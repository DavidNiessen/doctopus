import type { UiText, UiMessageKey } from '@davidniessen/doctopus-contracts';
import type { RelayErrorCode } from './relay-transport.js';
import type { OAuthPopupErrorCode } from './oauth-popup.js';

const relayKeys = {
  invalidResponse: 'relay.invalidResponse',
  invalidEndpoint: 'relay.invalidEndpoint',
  signIn: 'relay.signIn',
  denied: 'relay.denied',
  busy: 'relay.busy',
  failed: 'relay.failed',
  method: 'relay.method',
  bodyLimit: 'relay.bodyLimit',
  header: 'relay.header',
  unavailable: 'relay.unavailable',
} as const satisfies Record<RelayErrorCode | 'unavailable', UiMessageKey>;
const popupKeys = {
  cancelled: 'auth.cancelled',
  closed: 'auth.popupClosed',
  timeout: 'auth.popupTimeout',
  provider: 'auth.popupProvider',
  callback: 'auth.popupCallback',
  blocked: 'auth.popupBlocked',
  failed: 'auth.failed',
} as const satisfies Record<OAuthPopupErrorCode | 'failed', UiMessageKey>;
export const relayErrorText = (
  code: RelayErrorCode | 'unavailable',
  t: UiText,
) => t(relayKeys[code]);
export const popupErrorText = (
  code: OAuthPopupErrorCode | 'failed',
  t: UiText,
) => t(popupKeys[code]);
