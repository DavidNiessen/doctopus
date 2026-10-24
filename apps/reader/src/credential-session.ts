import type { ApiDocument, Operation } from '@davidniessen/doctopus-contracts';

export const CREDENTIAL_MEMORY_MS = 30 * 60 * 1000;
export interface CredentialValue {
  value: string;
  expiresAt?: number;
}
export type CredentialValues = Record<string, CredentialValue>;
export interface CredentialScope {
  localKey: string;
  group: string | undefined;
  keys: Map<string, string>;
}
export const emptyCredentials = (): CredentialValues =>
  Object.create(null) as CredentialValues;

/** Keys bind reuse to the actual destination and authentication policy, never an endpoint name alone. */
export function credentialScope(
  api: Pick<ApiDocument, 'id' | 'version' | 'securitySchemes'>,
  operation: Pick<Operation, 'security'>,
  server: string,
  clients?: Record<string, { clientId: string; issuer: string }>,
): CredentialScope {
  const scope: CredentialScope = {
    localKey: JSON.stringify([api.id, api.version, server]),
    group: undefined,
    keys: new Map(),
  };
  try {
    const destination = new URL(server);
    if (
      server.length > 4096 ||
      !['http:', 'https:'].includes(destination.protocol) ||
      destination.username ||
      destination.password ||
      destination.search ||
      destination.hash
    )
      return scope;
    scope.group = JSON.stringify([
      api.id,
      api.version,
      destination.href.replace(/\/$/, ''),
    ]);
    const names = new Set(
      operation.security.flatMap((alternative) => Object.keys(alternative)),
    );
    for (const name of names) {
      const scheme = Object.hasOwn(api.securitySchemes, name)
        ? api.securitySchemes[name]
        : undefined;
      if (!scheme) {
        scope.group = undefined;
        break;
      }
      const requirements =
        scheme.type === 'oauth2' || scheme.type === 'openIdConnect'
          ? [
              ...new Set(
                operation.security.find((alternative) =>
                  Object.hasOwn(alternative, name),
                )?.[name] ?? [],
              ),
            ].sort()
          : [];
      const key = JSON.stringify([
        name,
        scheme,
        clients?.[name] ?? null,
        requirements,
      ]);
      if (key.length > 16 * 1024) {
        scope.group = undefined;
        break;
      }
      scope.keys.set(name, key);
    }
  } catch {
    scope.group = undefined;
  }
  return scope;
}

/** A reader-instance memory cache. It has no storage, serialization or network interface. */
export function createCredentialSession() {
  type Group = { expiresAt: number; values: Map<string, CredentialValue> };
  const groups = new Map<string, Group>();
  const listeners = new Set<() => void>();
  let revision = 0,
    resetEpoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const enabled = (scope: CredentialScope) =>
    !!scope.group && (groups.get(scope.group)?.expiresAt ?? 0) > Date.now();
  const count = () =>
    [...groups.values()].reduce((total, group) => total + group.values.size, 0);
  const valid = (entry: CredentialValue) => {
    if (
      new TextEncoder().encode(entry.value).byteLength > 16 * 1024 ||
      /[\r\n]/.test(entry.value)
    )
      throw new Error(
        'This credential cannot be remembered. Use at most 16 KiB without newlines.',
      );
    if (
      entry.expiresAt !== undefined &&
      (!Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= 0)
    )
      throw new Error(
        'This credential has an invalid expiry and cannot be remembered.',
      );
  };
  const prune = () => {
    const now = Date.now();
    for (const [key, group] of groups) {
      if (group.expiresAt <= now) {
        groups.delete(key);
        continue;
      }
      for (const [key, entry] of group.values)
        if (entry.expiresAt !== undefined && entry.expiresAt <= now)
          group.values.delete(key);
    }
  };
  function publish() {
    clearTimeout(timer);
    const deadlines = [...groups.values()].flatMap((group) => [
      group.expiresAt,
      ...[...group.values.values()].flatMap((entry) =>
        entry.expiresAt === undefined ? [] : [entry.expiresAt],
      ),
    ]);
    if (deadlines.length)
      timer = setTimeout(
        () => {
          prune();
          publish();
        },
        Math.max(0, Math.min(...deadlines) - Date.now()),
      );
    revision++;
    for (const listener of listeners) listener();
  }
  const evict = (except: string) => {
    const oldest = [...groups.keys()].find((key) => key !== except);
    if (!oldest)
      throw new Error(
        'Too many credentials to remember. Clear saved credentials and try again.',
      );
    groups.delete(oldest);
  };
  return {
    getRevision: () => revision,
    getResetEpoch: () => resetEpoch,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isEnabled: enabled,
    hasRemembered: () =>
      [...groups.values()].some((group) => group.expiresAt > Date.now()),
    read(scope: CredentialScope): CredentialValues {
      const values = emptyCredentials();
      if (!enabled(scope)) return values;
      const group = groups.get(scope.group!)!;
      for (const [name, key] of scope.keys) {
        const entry = group.values.get(key);
        if (
          entry &&
          (entry.expiresAt === undefined || entry.expiresAt > Date.now())
        )
          values[name] = { ...entry };
      }
      return values;
    },
    remember(scope: CredentialScope, entries: CredentialValues) {
      if (!scope.group)
        throw new Error(
          'Credential reuse requires a valid destination and authentication policy.',
        );
      const values = new Map<string, CredentialValue>();
      for (const [name, entry] of Object.entries(entries)) {
        valid(entry);
        const key = scope.keys.get(name);
        if (
          key &&
          entry.value &&
          (entry.expiresAt === undefined || entry.expiresAt > Date.now())
        )
          values.set(key, { ...entry });
      }
      if (values.size > 32)
        throw new Error(
          'Too many credentials to remember. Clear saved credentials and try again.',
        );
      prune();
      while (
        (!groups.has(scope.group) && groups.size >= 8) ||
        count() - (groups.get(scope.group)?.values.size ?? 0) + values.size > 32
      )
        evict(scope.group);
      groups.set(scope.group, {
        expiresAt: Date.now() + CREDENTIAL_MEMORY_MS,
        values,
      });
      publish();
    },
    set(scope: CredentialScope, name: string, entry: CredentialValue): boolean {
      valid(entry);
      prune();
      if (!enabled(scope)) {
        publish();
        return false;
      }
      const key = scope.keys.get(name);
      if (!key)
        throw new Error('This authentication definition cannot be remembered.');
      const group = groups.get(scope.group!)!;
      if (
        !entry.value ||
        (entry.expiresAt !== undefined && entry.expiresAt <= Date.now())
      )
        group.values.delete(key);
      else {
        if (!group.values.has(key) && group.values.size >= 32)
          throw new Error(
            'Too many credentials to remember. Clear saved credentials and try again.',
          );
        while (!group.values.has(key) && count() >= 32) evict(scope.group!);
        group.values.set(key, { ...entry });
      }
      publish();
      return true;
    },
    forget(scope: CredentialScope) {
      if (scope.group) groups.delete(scope.group);
      publish();
    },
    clearAll() {
      groups.clear();
      resetEpoch++;
      publish();
    },
  };
}
export type CredentialSession = ReturnType<typeof createCredentialSession>;
