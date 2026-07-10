import { useLayoutEffect, useRef } from 'react';
import { STANDARD_EASE_CSS, prefersReducedMotion } from '../lib/easing';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

/**
 * iOS-style segmented control with the signature sliding highlight pill
 * (design language §4.4). One absolutely-positioned pill glides 400ms with
 * STANDARD_EASE from its current position to the active item; snaps on first
 * paint and reduced-motion; a ResizeObserver keeps it aligned. Labels only
 * cross-fade their color.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const btnRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const firstPaint = useRef(true);

  const movePill = (animate: boolean) => {
    const pill = pillRef.current;
    const btn = btnRefs.current.get(value);
    if (!pill || !btn) return;
    pill.style.transition =
      animate && !prefersReducedMotion()
        ? ['transform', 'width', 'height']
            .map((p) => `${p} 400ms ${STANDARD_EASE_CSS}`)
            .join(', ')
        : 'none';
    pill.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
    pill.style.width = `${btn.offsetWidth}px`;
    pill.style.height = `${btn.offsetHeight}px`;
    pill.style.opacity = '1';
  };

  // Reposition whenever the active value changes (animated after first paint).
  useLayoutEffect(() => {
    movePill(!firstPaint.current);
    firstPaint.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.length]);

  // Keep the pill aligned when the track's layout shifts (fonts, resize).
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => movePill(false));
    ro.observe(track);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className="relative inline-flex gap-0.5 rounded-xl border border-border bg-surface p-1"
    >
      <span
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 rounded-lg bg-surface-sunken opacity-0 shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
      />
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              if (el) btnRefs.current.set(opt.value, el);
              else btnRefs.current.delete(opt.value);
            }}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`relative z-[1] rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors duration-300 ${
              active ? 'text-ink' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
