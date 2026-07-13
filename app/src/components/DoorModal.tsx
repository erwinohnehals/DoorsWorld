import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, X } from 'lucide-react';
import type { Door } from '../lib/types';
import { STANDARD_EASE_CSS, prefersReducedMotion } from '../lib/easing';
import { formatCoords, formatDate, photoUrl, placeLabel } from '../lib/format';

interface DoorModalProps {
  /** The door to show, or null to close. */
  door: Door | null;
  /** All doors in the current filtered list, for prev/next navigation. */
  doors: Door[];
  onClose: () => void;
  onShowOnMap: (door: Door) => void;
  /** Called when the user navigates to a different door via arrows. */
  onNavigate: (door: Door) => void;
}

/**
 * Door detail modal (design language modal spec): backdrop fade 240ms, panel
 * rise 16px + scale 0.96 in 320ms STANDARD_EASE, exit 200ms sinking. Kept
 * mounted until animationend with a setTimeout fallback (+100ms). Esc and
 * backdrop-click close.
 */
export function DoorModal({ door, doors, onClose, onShowOnMap, onNavigate }: DoorModalProps) {
  const [shown, setShown] = useState<Door | null>(door);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (door) {
      window.clearTimeout(timerRef.current);
      setShown(door);
      setClosing(false);
    } else if (shown) {
      setClosing(true);
      const dur = prefersReducedMotion() ? 0 : 200 + 100;
      timerRef.current = window.setTimeout(() => {
        setShown(null);
        setClosing(false);
      }, dur);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [door]);

  const currentIndex = doors.findIndex((d) => d.id === shown?.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < doors.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) onNavigate(doors[currentIndex - 1]);
  }, [hasPrev, doors, currentIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (hasNext) onNavigate(doors[currentIndex + 1]);
  }, [hasNext, doors, currentIndex, onNavigate]);

  // Esc / arrow keys.
  useEffect(() => {
    if (!shown || closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, closing, onClose, goPrev, goNext]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  if (!shown) return null;

  const backdropAnim = closing
    ? `modal-backdrop-out 200ms ${STANDARD_EASE_CSS} forwards`
    : `modal-backdrop-in 240ms ${STANDARD_EASE_CSS}`;
  const panelAnim = closing
    ? `modal-panel-out 200ms ${STANDARD_EASE_CSS} forwards`
    : `modal-panel-in 320ms ${STANDARD_EASE_CSS}`;

  const aspect = shown.w && shown.h ? shown.w / shown.h : undefined;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 sm:p-6"
      style={{ animation: backdropAnim }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={placeLabel(shown)}
    >
      <div className="flex w-full items-center justify-center gap-3 sm:gap-4">
        {/* Prev arrow (outside the panel, desktop only) */}
        {hasPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label="Previous door"
            className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2/80 text-ink-2 backdrop-blur shadow-lg transition-colors duration-150 hover:bg-surface-3 hover:text-ink sm:flex"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {!hasPrev && <div className="hidden h-12 w-12 shrink-0 sm:block" aria-hidden />}

      <div
        className="card relative flex max-h-[90vh] w-full max-w-[55.44rem] flex-col overflow-hidden rounded-2xl border-border-strong shadow-2xl"
        style={{ animation: panelAnim }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2/80 text-ink-2 backdrop-blur transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-3 relative">
          <img
            src={photoUrl(shown.file, 'full')}
            alt={`Door in ${placeLabel(shown)}`}
            style={aspect ? { aspectRatio: String(aspect) } : undefined}
            className="max-h-[81.4vh] w-auto max-w-full object-contain"
          />

          {/* Prev/next arrows (inside the panel, mobile only) */}
          {hasPrev && (
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous door"
              className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-2/80 text-ink-2 backdrop-blur shadow-lg sm:hidden"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={goNext}
              aria-label="Next door"
              className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-2/80 text-ink-2 backdrop-blur shadow-lg sm:hidden"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Counter */}
          {currentIndex >= 0 && doors.length > 1 && (
            <span className="absolute bottom-2 right-2 z-10 rounded-full bg-surface-2/70 px-2.5 py-0.5 text-xs text-ink-2 backdrop-blur">
              {currentIndex + 1} / {doors.length}
            </span>
          )}
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-border px-5 pb-5 pt-12">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-ink">
              {placeLabel(shown)}
            </h2>
            {shown.date && (
              <p className="mt-0.5 text-sm text-ink-2">{formatDate(shown.date)}</p>
            )}
            <p className="mt-1 font-mono text-xs text-ink-3">
              {formatCoords(shown.lat, shown.lon)}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm shrink-0 whitespace-nowrap px-3 py-1.5 text-sm"
            style={{ minHeight: 40 }}
            onClick={() => onShowOnMap(shown)}
          >
            <MapPin className="h-4 w-4" />
            Show on map
          </button>
        </div>
      </div>

      {/* Next arrow (outside the panel, desktop only) */}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label="Next door"
          className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2/80 text-ink-2 backdrop-blur shadow-lg transition-colors duration-150 hover:bg-surface-3 hover:text-ink sm:flex"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      {!hasNext && <div className="hidden h-12 w-12 shrink-0 sm:block" aria-hidden />}
      </div>
    </div>
  );
}
