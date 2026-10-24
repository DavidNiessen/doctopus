import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const initial = 240;
const minimum = 200;
const maximum = 360;
const storageKey = 'doctopus-studio-navigation-width';

/** Resize the CSS track without rerendering the workspace or its forms. */
export function NavigationResize({
  target,
}: {
  target: RefObject<HTMLDivElement | null>;
}) {
  const [width, setWidth] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const current = useRef(initial);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(
    null,
  );
  function apply(value: number) {
    const next = Math.max(minimum, Math.min(maximum, Math.round(value)));
    current.current = next;
    target.current?.style.setProperty('--studio-sidebar-width', `${next}px`);
    setWidth(next);
  }
  function save() {
    try {
      localStorage.setItem(storageKey, String(current.current));
    } catch {
      /* Resizing remains usable when storage is unavailable. */
    }
  }
  // The parent workspace ref is attached before passive effects run.
  useEffect(() => {
    let value = initial;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && /^\d{3}$/.test(stored)) value = Number(stored);
    } catch {
      /* Use the default when storage is unavailable. */
    }
    const next = Math.max(minimum, Math.min(maximum, value));
    current.current = next;
    target.current?.style.setProperty('--studio-sidebar-width', `${next}px`);
    setWidth(next);
  }, [target]);
  return (
    <div
      className="studio-navigation-resize"
      role="separator"
      tabIndex={0}
      aria-label="Resize navigation panel"
      aria-controls="studio-navigation"
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={`Preferred width ${width} pixels`}
      title="Drag or use arrow keys to resize. Double-click to reset."
      data-dragging={dragging || undefined}
      onDoubleClick={() => {
        apply(initial);
        save();
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
          return;
        event.preventDefault();
        const step = event.shiftKey ? 32 : 16;
        apply(
          event.key === 'Home'
            ? minimum
            : event.key === 'End'
              ? maximum
              : current.current + (event.key === 'ArrowRight' ? step : -step),
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
          width: current.current,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointer === event.pointerId)
          apply(start.width + event.clientX - start.x);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
        save();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) apply(drag.current.width);
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
