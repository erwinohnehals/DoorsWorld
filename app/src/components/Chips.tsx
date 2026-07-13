import { useSlidingPill } from '../lib/useSlidingPill';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipsProps<T extends string> {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

/**
 * Row of filter chips sharing the Segmented sliding-pill mechanic: a filled
 * pill glides between chips while labels cross-fade. Inactive chips are
 * outlined; the active chip drops its border so the dark pill shows through.
 * Below `sm` the row is a single line that scrolls horizontally (scrollbar
 * hidden); from `sm` up it wraps, and the pill glides across wrapped lines.
 */
export function Chips<T extends string>({ options, value, onChange, ariaLabel }: ChipsProps<T>) {
  const { trackRef, pillRef, setBtnRef } = useSlidingPill(
    value,
    options.map((o) => o.value).join('|'),
  );

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible"
    >
      <span
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 rounded-full bg-ink opacity-0"
      />
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={setBtnRef(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={(e) => {
              onChange(opt.value);
              // A tapped chip may sit half-cut at the scroll edge on mobile.
              e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }}
            className={`relative z-[1] shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-300 ${
              active
                ? 'border-transparent text-surface'
                : 'border-border text-ink-2 hover:border-border-strong hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
