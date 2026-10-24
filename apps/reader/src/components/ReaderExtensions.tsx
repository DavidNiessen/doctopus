import { useEffect, useRef } from 'react';
import {
  createReaderExtensionSession,
  defineReaderExtension,
} from '@davidniessen/doctopus-plugin-sdk/browser';
import type {
  ReaderExtension,
  ReaderPage,
} from '@davidniessen/doctopus-plugin-sdk/browser';
import type { ReaderExtensionAsset } from '@davidniessen/doctopus-contracts';
type Session = ReturnType<typeof createReaderExtensionSession>;
function assetUrl(asset: ReaderExtensionAsset, basePath: string) {
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(asset.id) ||
    !/^[a-f0-9]{64}$/.test(asset.digest) ||
    !asset.entry.startsWith(`reader-extensions/${asset.id}/${asset.digest}/`) ||
    !asset.entry
      .split('/')
      .every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)) ||
    !/\.m?js$/.test(asset.entry)
  )
    throw new Error('Invalid reader extension asset');
  return basePath + '/' + asset.entry;
}
export default function ReaderExtensions({
  assets,
  basePath,
  page,
}: {
  assets: ReaderExtensionAsset[];
  basePath: string;
  page: ReaderPage;
}) {
  const container = useRef<HTMLDivElement>(null);
  const sessions = useRef<Session[]>([]);
  const current = useRef(page);
  current.current = page;
  const key = JSON.stringify(assets);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let stopped = false;
    let cancelLoads: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancelLoads = () => reject(new Error('Reader extension host closed'));
    });
    void cancelled.catch(() => {});
    const timers = new Set<ReturnType<typeof setTimeout>>();
    root.hidden = true;
    for (const asset of assets) {
      const slot = document.createElement('div');
      slot.dataset.readerExtension = asset.id;
      root.append(slot);
      const warn = () => {
        if (!stopped) console.warn('Reader extension unavailable:', asset.id);
      };
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const url = assetUrl(asset, basePath);
          const module = await Promise.race([
            cancelled,
            import(/* @vite-ignore */ url) as Promise<{
              default: ReaderExtension;
            }>,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Reader extension load timed out')),
                5000,
              );
              timers.add(timer);
            }),
          ]);
          if (stopped) return;
          const extension = defineReaderExtension(module.default);
          if (extension.id !== asset.id)
            throw new Error('Reader extension identity mismatch');
          const session = createReaderExtensionSession(
            extension,
            current.current,
            {
              basePath,
              onError: warn,
              mount(widget) {
                slot.replaceChildren();
                if (widget) {
                  if (!(widget.element instanceof HTMLElement))
                    throw new Error(
                      'Reader extension widgets require an HTMLElement',
                    );
                  slot.append(widget.element);
                }
                root.hidden = ![...root.children].some(
                  (child) => child.childElementCount > 0,
                );
              },
            },
          );
          sessions.current.push(session);
          await session.ready;
        } catch {
          if (!stopped) warn();
        } finally {
          if (timer) {
            clearTimeout(timer);
            timers.delete(timer);
          }
        }
      })();
    }
    const dispose = () => {
      if (stopped) return;
      stopped = true;
      cancelLoads();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const session of sessions.current) session.dispose();
      sessions.current = [];
      root.replaceChildren();
      root.hidden = true;
    };
    window.addEventListener('pagehide', dispose, { once: true });
    return () => {
      window.removeEventListener('pagehide', dispose);
      dispose();
    };
  }, [key, basePath]);
  useEffect(() => {
    for (const session of sessions.current) session.update(page);
  }, [page.path, page.title, page.locale, page.kind]);
  return <div ref={container} className="reader-extension-host" />;
}
