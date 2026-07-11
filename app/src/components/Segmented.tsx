import { useSlidingPill } from '../lib/useSlidingPill';

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
 * (design language §4.4). The pill mechanics live in useSlidingPill; labels
 * only cross-fade their color.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  const { trackRef, pillRef, setBtnRef } = useSlidingPill(
    value,
    options.map((o) => o.value).join('|'),
  );

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
            ref={setBtnRef(opt.value)}
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
