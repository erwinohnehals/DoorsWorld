import { useEffect, useMemo, useRef, useState } from 'react';
import doorsData from './data/doors.json';
import type { Door } from './lib/types';
import { useTheme } from './lib/useTheme';
import { POWER1_IN_CSS, POWER1_OUT_CSS, prefersReducedMotion } from './lib/easing';
import { Segmented } from './components/Segmented';
import { ThemeToggle } from './components/ThemeToggle';
import { MapView, type MapHandle } from './components/MapView';
import { Gallery } from './components/Gallery';
import { DoorModal } from './components/DoorModal';

const DOORS = (doorsData as unknown as Door[]).filter(
  (d) => typeof d.lat === 'number' && typeof d.lon === 'number',
);

type View = 'map' | 'gallery';
type YearFilter = string; // 'all' | '2022' | ...
type CountryFilter = string; // 'all' | 'Czechia' | ...
type CityFilter = string; // 'all' | 'Prague' | ...

const viewInAnim = (delayMs = 0) =>
  prefersReducedMotion()
    ? undefined
    : `view-in 250ms ${POWER1_OUT_CSS} ${delayMs}ms backwards`;

// View switch (§4.3): out 250ms POWER1_IN, in 250ms POWER1_OUT starting
// 100ms before the out ends — so the entrance is delayed 150ms.
const VIEW_OUT_ANIM = `view-out 250ms ${POWER1_IN_CSS} forwards`;
const VIEW_IN_ANIM = `view-in 250ms ${POWER1_OUT_CSS} 150ms backwards`;
const VIEW_SWITCH_TOTAL_MS = 150 + 250 + 20;

export default function App() {
  const { theme, toggle } = useTheme();
  const [view, setView] = useState<View>('map');
  const [leaving, setLeaving] = useState<View | null>(null);
  const [year, setYear] = useState<YearFilter>('all');
  const [country, setCountry] = useState<CountryFilter>('all');
  const [city, setCity] = useState<CityFilter>('all');
  const [selected, setSelected] = useState<Door | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const switchTimer = useRef<number | undefined>(undefined);

  const changeView = (next: View) => {
    if (next === view) return;
    window.clearTimeout(switchTimer.current);
    if (prefersReducedMotion()) {
      setLeaving(null);
      setView(next);
      return;
    }
    setLeaving(view);
    setView(next);
    switchTimer.current = window.setTimeout(() => setLeaving(null), VIEW_SWITCH_TOTAL_MS);
  };

  useEffect(() => () => window.clearTimeout(switchTimer.current), []);

  // Animation for a view layer: exit while leaving, delayed entrance while
  // its counterpart leaves, none at rest (so hover/state styles stay intact).
  const layerAnim = (which: View): string | undefined => {
    if (leaving === which) return VIEW_OUT_ANIM;
    if (leaving && view === which) return VIEW_IN_ANIM;
    return undefined;
  };

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const d of DOORS) if (d.year != null) set.add(d.year);
    return [...set].sort((a, b) => a - b);
  }, []);

  // Country & city options always show the full universe — independent of year filter.
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of DOORS) if (d.country) set.add(d.country);
    return [...set].sort();
  }, []);

  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of DOORS) if (d.city) set.add(d.city);
    return [...set].sort();
  }, []);

  // Filters are independent — intersection of all three.
  const filtered = useMemo(() => {
    let result = DOORS;
    if (year !== 'all') result = result.filter((d) => String(d.year) === year);
    if (country !== 'all') result = result.filter((d) => d.country === country);
    if (city !== 'all') result = result.filter((d) => d.city === city);
    return result;
  }, [year, country, city]);

  const countryCount = useMemo(
    () => new Set(filtered.map((d) => d.country).filter(Boolean)).size,
    [filtered],
  );

  const cityCount = useMemo(
    () => new Set(filtered.map((d) => d.city).filter(Boolean)).size,
    [filtered],
  );

  const viewOptions = [
    { value: 'map' as const, label: 'Map' },
    { value: 'gallery' as const, label: 'Gallery' },
  ];
  const yearOptions = [
    { value: 'all', label: 'All' },
    ...years.map((y) => ({ value: String(y), label: String(y) })),
  ];

  // When the map becomes visible again, Leaflet must recompute its size.
  useEffect(() => {
    if (view === 'map') {
      const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 60);
      return () => window.clearTimeout(id);
    }
  }, [view]);

  const handleShowOnMap = (door: Door) => {
    setSelected(null);
    setView('map');
    window.setTimeout(() => {
      mapRef.current?.invalidateSize();
      mapRef.current?.flyTo(door);
    }, 80);
  };

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Map layer — kept mounted for the whole session (never destroy Leaflet). */}
      <div
        className={`absolute inset-0 ${
          view === 'map' || leaving === 'map' ? '' : 'hidden'
        } ${leaving === 'map' ? 'pointer-events-none' : ''}`}
        style={{ animation: layerAnim('map') }}
      >
        <MapView ref={mapRef} doors={filtered} theme={theme} onSelect={setSelected} />
      </div>

      {/* Gallery layer — stays mounted through its exit so view-out can play. */}
      {(view === 'gallery' || leaving === 'gallery') && (
        <div
          className={`absolute inset-0 bg-surface ${
            leaving === 'gallery' ? 'pointer-events-none' : ''
          }`}
          style={{ animation: layerAnim('gallery') }}
        >
          <Gallery
            key={`${year}-${country}-${city}`}
            doors={filtered}
            onSelect={setSelected}
            baseDelayMs={leaving && view === 'gallery' ? 150 : 0}
          />
        </div>
      )}

      {/* Header card, top-left. */}
      <header
        className="card pointer-events-auto absolute left-4 top-4 z-[500] flex flex-col gap-3 rounded-xl p-4"
        style={{ animation: viewInAnim(0) }}
      >
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">
            Doors of the World
          </h1>
          <p className="mt-0.5 text-sm text-ink-3">
            {filtered.length} {filtered.length === 1 ? 'door' : 'doors'} ·{' '}
            {countryCount} {countryCount === 1 ? 'country' : 'countries'}
            {city !== 'all' && <> · {cityCount} {cityCount === 1 ? 'city' : 'cities'}</>}
          </p>
        </div>
        <Segmented options={viewOptions} value={view} onChange={changeView} ariaLabel="View" />
        <Segmented options={yearOptions} value={year} onChange={setYear} ariaLabel="Filter by year" />

        {/* Country & city dropdowns — only in gallery view */}
        {view === 'gallery' && (
          <div className="flex gap-2">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              aria-label="Filter by country"
              className="flex-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Countries</option>
              {countryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              aria-label="Filter by city"
              className="flex-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <option value="all">All Cities</option>
              {cityOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </header>

      {/* Theme toggle, top-right. */}
      <div className="absolute right-4 top-4 z-[500]">
        <ThemeToggle theme={theme} onToggle={toggle} />
      </div>

      <DoorModal
        door={selected}
        doors={filtered}
        onClose={() => setSelected(null)}
        onShowOnMap={handleShowOnMap}
        onNavigate={setSelected}
      />
    </div>
  );
}
