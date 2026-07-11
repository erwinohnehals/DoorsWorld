import { useCallback, useLayoutEffect, useRef } from 'react';
import { STANDARD_EASE_CSS, prefersReducedMotion } from './easing';

/**
 * Shared engine for the sliding highlight pill (design language §4.4): one
 * absolutely-positioned pill glides 400ms with STANDARD_EASE from its current
 * position to the active item; snaps on first paint and reduced-motion; a
 * ResizeObserver keeps it aligned. Position uses offsetLeft/offsetTop, so it
 * also glides across wrapped lines (used by Chips).
 */
export function useSlidingPill<T extends string>(value: T, optionsKey: string) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const btnRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const firstPaint = useRef(true);
  // Keep latest value in a ref so the persistent ResizeObserver always
  // positions the pill against the correct active button — without needing
  // to recreate the observer (which would fire spuriously and kill the
  // transition mid-flight).
  const valueRef = useRef(value);
  valueRef.current = value;
  // Timestamp until which a glide is considered in-flight, so a mid-glide
  // resize retargets the transition instead of snapping it dead.
  const glideUntil = useRef(0);

  const movePill = useCallback((animate: boolean) => {
    const pill = pillRef.current;
    const btn = btnRefs.current.get(valueRef.current);
    if (!pill || !btn) return;
    const animated = animate && !prefersReducedMotion();
    if (animated) glideUntil.current = performance.now() + 450;
    pill.style.transition = animated
      ? ['transform', 'width', 'height']
          .map((p) => `${p} 400ms ${STANDARD_EASE_CSS}`)
          .join(', ')
      : 'none';
    pill.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
    pill.style.width = `${btn.offsetWidth}px`;
    pill.style.height = `${btn.offsetHeight}px`;
    pill.style.opacity = '1';
  }, []);

  // Reposition whenever the active value or the option set changes
  // (animated after first paint).
  useLayoutEffect(() => {
    movePill(!firstPaint.current);
    firstPaint.current = false;
  }, [value, optionsKey, movePill]);

  // Keep the pill aligned when the track's layout shifts (fonts, resize,
  // chip wrapping). Snaps at rest; retargets (animated, from the current
  // interpolated position) if the shift lands mid-glide — e.g. a scrollbar
  // toggle or a sibling mounting while the pill is travelling.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => movePill(performance.now() < glideUntil.current));
    ro.observe(track);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBtnRef = useCallback(
    (v: T) => (el: HTMLButtonElement | null) => {
      if (el) btnRefs.current.set(v, el);
      else btnRefs.current.delete(v);
    },
    [],
  );

  return { trackRef, pillRef, setBtnRef };
}
