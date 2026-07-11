import type { CSSProperties } from 'react';
import type { Door } from '../lib/types';
import { STANDARD_EASE_CSS } from '../lib/easing';
import { formatDate, placeLabel } from '../lib/format';

interface GalleryProps {
  doors: Door[];
  onSelect: (door: Door) => void;
  /** Extra delay before the cascade starts (view-switch entrance overlap). */
  baseDelayMs?: number;
}

const STAGGER_CAP = 24;

/**
 * Responsive grid of door thumbnails. Cards stagger in per the list-stagger
 * spec (250ms STANDARD_EASE, 50ms/item, rise 20px, backwards fill, capped at
 * ~24). Hover lifts the card 2px. Mounting fresh on view-switch replays the
 * cascade; reduced-motion collapses it via the global rule. The scroll
 * container lives in App so the filter bar can sit in-flow above the grid.
 */
export function Gallery({ doors, onSelect, baseDelayMs = 0 }: GalleryProps) {
  return (
    <div className="px-4 pb-10 pt-3 sm:px-6">
      <div className="mx-0 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {doors.map((door, i) => {
          const delay = baseDelayMs + Math.min(i, STAGGER_CAP) * 50;
          const aspect = door.w && door.h ? door.w / door.h : 1;
          return (
            <button
              key={door.id}
              type="button"
              onClick={() => onSelect(door)}
              style={{
                ['--rise-y' as string]: '20px',
                animation: `rise-in 250ms ${STANDARD_EASE_CSS} ${delay}ms backwards`,
              } as CSSProperties}
              className="group card block overflow-hidden rounded-xl p-0 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="overflow-hidden bg-surface-3" style={{ aspectRatio: String(aspect) }}>
                <img
                  src={`/photos/${door.file}-thumb.webp`}
                  alt={`Door in ${placeLabel(door)}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="px-3 py-2">
                <p className="truncate text-sm font-medium text-ink">{placeLabel(door)}</p>
                {door.date && (
                  <p className="mt-0.5 truncate text-xs text-ink-3">{formatDate(door.date)}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {doors.length === 0 && (
        <p className="mt-10 text-sm text-ink-3">No doors match these filters.</p>
      )}
    </div>
  );
}
