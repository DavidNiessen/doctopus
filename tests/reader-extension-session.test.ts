import { afterEach, expect, it, vi } from 'vitest';
import {
  createReaderExtensionSession,
  defineReaderExtension,
} from '@davidniessen/doctopus-plugin-sdk/browser';
import type {
  ReaderExtension,
  ReaderExtensionContext,
  ReaderPage,
  ReaderWidget,
} from '@davidniessen/doctopus-plugin-sdk/browser';
const page: ReaderPage = {
  path: '/guides/start/',
  title: 'Start',
  locale: 'en',
  kind: 'guide',
};
const plugin = (activate: ReaderExtension['activate']): ReaderExtension => ({
  id: 'fixture',
  version: '1.0.0',
  pluginApi: '1',
  capabilities: ['page', 'footer'],
  activate,
});
afterEach(() => vi.useRealTimers());
it('publishes immutable, minimal page snapshots and unsubscribes on disposal', async () => {
  const received: Readonly<ReaderPage>[] = [],
    dispose = vi.fn();
  let context: ReaderExtensionContext | undefined;
  const session = createReaderExtensionSession(
    plugin((ctx) => {
      context = ctx;
      ctx.onPageChange((value) => received.push(value));
      return dispose;
    }),
    { ...page, privateQuery: 'secret' } as ReaderPage,
    { basePath: '/docs', mount: vi.fn() },
  );
  expect(await session.ready).toBe(true);
  expect(received).toEqual([page]);
  expect(Object.isFrozen(received[0])).toBe(true);
  session.update({ ...page, path: '/api/items/', kind: 'operation' });
  expect(received).toHaveLength(2);
  expect(context?.getPage().path).toBe('/api/items/');
  session.dispose();
  session.dispose();
  expect(context?.signal.aborted).toBe(true);
  expect(dispose).toHaveBeenCalledTimes(1);
  session.update(page);
  expect(received).toHaveLength(2);
});
it('supports explicit unsubscribe and contains no browser query or request inputs', async () => {
  const callback = vi.fn();
  let unsubscribe = () => {};
  const session = createReaderExtensionSession(
    plugin((ctx) => {
      unsubscribe = ctx.onPageChange(callback);
    }),
    page,
    { basePath: '', mount: vi.fn() },
  );
  await session.ready;
  unsubscribe();
  session.update({ ...page, title: 'Next' });
  expect(callback).toHaveBeenCalledTimes(1);
  session.dispose();
});
it.each(['/page/?token=secret', '/page/#private', 'relative'])(
  'rejects non-page route metadata %s',
  (path) => {
    expect(() =>
      createReaderExtensionSession(
        plugin(() => {}),
        { ...page, path },
        { basePath: '', mount: vi.fn() },
      ),
    ).toThrow(/page metadata/);
  },
);
it('disposes old widgets on navigation and removes the final widget on teardown', async () => {
  const disposers = [vi.fn(), vi.fn()],
    mounted: (ReaderWidget | undefined)[] = [];
  let index = 0;
  const session = createReaderExtensionSession(
    plugin((ctx) => {
      ctx.setFooter(() => ({
        element: { id: 'widget-' + index } as unknown as HTMLElement,
        dispose: disposers[index++]!,
      }));
    }),
    page,
    { basePath: '', mount: (widget) => mounted.push(widget) },
  );
  await session.ready;
  expect(mounted.at(-1)?.element.id).toBe('widget-0');
  session.update({ ...page, title: 'Next' });
  expect(disposers[0]).toHaveBeenCalledTimes(1);
  expect(mounted.at(-1)?.element.id).toBe('widget-1');
  session.dispose();
  expect(disposers[1]).toHaveBeenCalledTimes(1);
  expect(mounted.at(-1)).toBeUndefined();
});
it('isolates activation and page-handler failures and never forwards exception details', async () => {
  const error = vi.fn(),
    mount = vi.fn();
  const bad = createReaderExtensionSession(
    plugin(() => {
      throw new Error('private-value');
    }),
    page,
    { basePath: '', mount, onError: error },
  );
  expect(await bad.ready).toBe(false);
  expect(error.mock.calls).toEqual([[]]);
  const handler = createReaderExtensionSession(
    plugin((ctx) =>
      ctx.onPageChange((value) => {
        if (value.title === 'Bad') throw new Error('private-value');
      }),
    ),
    page,
    { basePath: '', mount, onError: error },
  );
  expect(await handler.ready).toBe(true);
  handler.update({ ...page, title: 'Bad' });
  handler.update(page);
  expect(error).toHaveBeenCalledTimes(2);
});
it('requires declared SDK capabilities before mounting and tolerates faulty cleanup', async () => {
  const error = vi.fn();
  const session = createReaderExtensionSession(
    {
      ...plugin((ctx) => {
        ctx.setFooter(() => ({ element: {} as HTMLElement }));
      }),
      capabilities: ['page'],
    },
    page,
    { basePath: '', mount: vi.fn(), onError: error },
  );
  expect(await session.ready).toBe(false);
  expect(error).toHaveBeenCalledTimes(1);
  const cleanup = createReaderExtensionSession(
    plugin(() => () => {
      throw new Error('private-value');
    }),
    page,
    {
      basePath: '',
      mount: () => {
        throw new Error('private-value');
      },
    },
  );
  expect(await cleanup.ready).toBe(true);
  expect(() => cleanup.dispose()).not.toThrow();
});
it('bounds pending activation and runs late cleanup without reactivating the session', async () => {
  vi.useFakeTimers();
  let finish: (value: () => void) => void = () => {};
  const cleanup = vi.fn(),
    error = vi.fn();
  let context: ReaderExtensionContext | undefined;
  const session = createReaderExtensionSession(
    plugin((ctx) => {
      context = ctx;
      return new Promise((resolve) => (finish = resolve));
    }),
    page,
    { basePath: '', mount: vi.fn(), onError: error },
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(await session.ready).toBe(false);
  expect(context?.signal.aborted).toBe(true);
  finish(cleanup);
  await vi.runAllTimersAsync();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);
});
it('settles pending activation on explicit disposal and clears its watchdog', async () => {
  vi.useFakeTimers();
  let finish: () => void = () => {};
  const session = createReaderExtensionSession(
    plugin(() => new Promise<void>((resolve) => (finish = resolve))),
    page,
    { basePath: '', mount: vi.fn() },
  );
  await vi.advanceTimersByTimeAsync(0);
  session.dispose();
  expect(await session.ready).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  finish();
  await vi.runAllTimersAsync();
});
it.each([
  { id: undefined },
  { version: 'current' },
  { pluginApi: '2' },
  { capabilities: ['page', 'page'] },
  { capabilities: ['network'] },
  { activate: null },
])('rejects invalid extension declarations %#', (extra) => {
  expect(() =>
    defineReaderExtension({
      ...plugin(() => {}),
      ...extra,
    } as unknown as ReaderExtension),
  ).toThrow(/metadata/);
});
