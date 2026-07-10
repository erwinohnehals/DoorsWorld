// Canonical easing curves from the Kairro design language (§4.1).
// Never re-type these numbers — import from here.

/** The house curve. Default for every animation. */
export const STANDARD_EASE_CSS = 'cubic-bezier(0.625, 0.05, 0, 1)';

/** Item creation, completion scale — fast arrival, gentle stop. */
export const EXPO_OUT_CSS = 'cubic-bezier(0.19, 1, 0.22, 1)';

/** Gentle fades, view-transition entrances. */
export const POWER1_OUT_CSS = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

/** Exits only (view-out). */
export const POWER1_IN_CSS = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)';

/** True when the user prefers reduced motion. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
