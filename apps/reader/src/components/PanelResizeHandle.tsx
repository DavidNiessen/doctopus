import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useUi } from '../ui-translation.js';

/** Changes only a CSS track during dragging; the documentation tree does not rerender. */
export function PanelResizeHandle({
  target,
  property,
  initial,
  min,
  max,
  label,
  controls,
  storageKey,
  reverse = false,
  className = '',
}: {
  target: RefObject<HTMLElement | null>;
  property: `--${string}`;
  initial: number;
  min: number;
  max: number;
  label: string;
  controls: string;
  storageKey: string;
  reverse?: boolean;
  className?: string;
}) {
  const t = useUi();
  const [size, setSize] = useState(initial);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const value = useRef(initial);
  const drag = useRef<{ pointer: number; x: number; size: number } | null>(
    null,
  );
  const key = `doctopus-layout:${storageKey}:${property}`;
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  function apply(next: number) {
    const width = clamp(Math.round(next));
    value.current = width;
    target.current?.style.setProperty(property, `${width}px`);
    setSize(width);
  }
  function save() {
    try {
      localStorage.setItem(key, String(value.current));
    } catch {
      /* Storage is optional. */
    }
  }
  useEffect(() => {
    let width = initial;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null && /^\d{2,4}$/.test(stored)) width = Number(stored);
    } catch {
      /* Use the configured width when storage is unavailable. */
    }
    width = Math.max(min, Math.min(max, width));
    value.current = width;
    target.current?.style.setProperty(property, `${width}px`);
    setSize(width);
    setReady(true);
  }, [key, initial, min, max, property, target]);
  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    const cursor = root.style.cursor,
      selection = root.style.userSelect;
    root.style.cursor = 'col-resize';
    root.style.userSelect = 'none';
    return () => {
      root.style.cursor = cursor;
      root.style.userSelect = selection;
    };
  }, [dragging]);
  return (
    <div
      role="separator"
      tabIndex={ready ? 0 : -1}
      aria-hidden={!ready || undefined}
      style={ready ? undefined : { visibility: 'hidden' }}
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={size}
      aria-valuetext={t('layout.preferredWidth', { width: size })}
      title={t('layout.resizeHint')}
      className={`panel-resize-handle ${className}`}
      data-dragging={dragging || undefined}
      onDoubleClick={() => {
        apply(initial);
        save();
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
          return;
        event.preventDefault();
        const step = (event.shiftKey ? 32 : 16) * (reverse ? -1 : 1);
        apply(
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : value.current + (event.key === 'ArrowRight' ? step : -step),
        );
        save();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          size: value.current,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointer === event.pointerId)
          apply(start.size + (event.clientX - start.x) * (reverse ? -1 : 1));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
        save();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) apply(drag.current.size);
        drag.current = null;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
