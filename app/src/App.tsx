import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import doorsData from './data/doors.json';
import type { Door } from './lib/types';
import { useTheme } from './lib/useTheme';
import { POWER1_IN_CSS, POWER1_OUT_CSS, prefersReducedMotion } from './lib/easing';
import { Segmented } from './components/Segmented';
import { Chips } from './components/Chips';
import { ThemeToggle } from './components/ThemeToggle';
import { MapView, type MapHandle } from './components/MapView';
import { Gallery } from './components/Gallery';
import { DoorModal } from './components/DoorModal';
import { AddDoor } from './components/AddDoor';
import { takeSharedFiles } from './lib/shareInbox';

const DOORS = (doorsData as unknown as Door[]).filter(
  (d) => typeof d.lat === 'number' && typeof d.lon === 'number',
);

type View = 'map' | 'gallery';
type YearFilter = string; // 'all' | '2022' | ...
type CountryFilter = string; // 'all' | 'Czechia' | ...
type CityFilter = string; // 'all' | 'Prague' | ...

// View switch (§4.3): out 250ms POWER1_IN, in 250ms POWER1_OUT starting
// 100ms before the out ends — so the entrance is delayed 150ms.
const VIEW_OUT_ANIM = `view-out 250ms ${POWER1_IN_CSS} forwards`;
const VIEW_IN_ANIM = `view-in 250ms ${POWER1_OUT_CSS} 150ms backwards`;
const VIEW_SWITCH_TOTAL_MS = 150 + 250 + 20;

export default function App() {
  const { theme, toggle } = useTheme();
  const [view, setView] = useState<View>('gallery');
  const [leaving, setLeaving] = useState<View | null>(null);
  const [year, setYear] = useState<YearFilter>('all');
  const [country, setCountry] = useState<CountryFilter>('all');
  const [city, setCity] = useState<CityFilter>('all');
  const [selected, setSelected] = useState<Door | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sharedFiles, setSharedFiles] = useState<File[] | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const galleryScrollRef = useRef<HTMLDivElement>(null);
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

  // Pick up photos stashed by the service worker after an Android
  // share-sheet launch (?shared=1) and open the ingest modal with them.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('shared')) return;
    window.history.replaceState(null, '', window.location.pathname);
    takeSharedFiles().then((files) => {
      if (files.length) {
        setSharedFiles(files);
        setAddOpen(true);
      }
    });
  }, []);

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

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of DOORS) if (d.country) set.add(d.country);
    return [...set].sort();
  }, []);

  // City options depend on the selected country — only cities from that
  // country, most doors first so the useful chips lead the row.
  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of DOORS) {
      if (d.city && (country === 'all' || d.country === country)) {
        counts.set(d.city, (counts.get(d.city) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([c]) => c);
  }, [country]);

  // Reset city when country changes and current city isn't available.
  useEffect(() => {
    if (city !== 'all' && !cityOptions.includes(city)) {
      setCity('all');
    }
  }, [country, city, cityOptions]);

  // Filters are independent — intersection of all three. They only apply to
  // the gallery; the map always shows every door.
  const filtered = useMemo(() => {
    let result = DOORS;
    if (year !== 'all') result = result.filter((d) => String(d.year) === year);
    if (country !== 'all') result = result.filter((d) => d.country === country);
    if (city !== 'all') result = result.filter((d) => d.city === city);
    return result;
  }, [year, country, city]);

  const visibleDoors = view === 'map' ? DOORS : filtered;

  const countryCount = useMemo(
    () => new Set(visibleDoors.map((d) => d.country).filter(Boolean)).size,
    [visibleDoors],
  );

  const cityCount = useMemo(
    () => new Set(visibleDoors.map((d) => d.city).filter(Boolean)).size,
    [visibleDoors],
  );

  const hasFilters = year !== 'all' || country !== 'all' || city !== 'all';
  const clearFilters = () => {
    setYear('all');
    setCountry('all');
    setCity('all');
  };

  const viewOptions = [
    { value: 'gallery' as const, label: 'Gallery' },
    { value: 'map' as const, label: 'Map' },
  ];

  // When the map becomes visible again, Leaflet must recompute its size.
  useEffect(() => {
    if (view === 'map') {
      const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 60);
      return () => window.clearTimeout(id);
    }
  }, [view]);

  // Changing a filter can shrink the grid a lot — snap back to the top.
  useEffect(() => {
    galleryScrollRef.current?.scrollTo({ top: 0 });
  }, [year, country, city]);

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
      {/* Map layer — kept mounted for the whole session (never destroy Leaflet).
          Unfiltered: the map itself is the geographic filter. */}
      <div
        className={`absolute inset-0 ${
          view === 'map' || leaving === 'map' ? '' : 'hidden'
        } ${leaving === 'map' ? 'pointer-events-none' : ''}`}
        style={{ animation: layerAnim('map') }}
      >
        <MapView ref={mapRef} doors={DOORS} theme={theme} onSelect={setSelected} />
      </div>

      {/* Gallery layer — stays mounted through its exit so view-out can play. */}
      {(view === 'gallery' || leaving === 'gallery') && (
        <div
          className={`absolute inset-0 bg-surface ${
            leaving === 'gallery' ? 'pointer-events-none' : ''
          }`}
          style={{ animation: layerAnim('gallery') }}
        >
          {/* Scroll container starts below the top bar; the filter bar is
              in-flow, so it scrolls away and never covers a door. Stable
              scrollbar gutter: filter changes toggle the scrollbar, and the
              width jump would knock the chip pill off mid-glide. */}
          <div
            ref={galleryScrollRef}
            className="h-full overflow-y-auto pt-16 [scrollbar-gutter:stable]"
          >
            <div className="flex flex-col gap-2.5 px-4 pb-1 pt-4 sm:px-6">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <span className="w-14 shrink-0 pt-1.5 text-xs font-medium uppercase tracking-wide text-ink-3">
                  Country
                </span>
                <div className="min-w-0 flex-1">
                  <Chips
                    options={[
                      { value: 'all' as CountryFilter, label: 'All' },
                      ...countryOptions.map((c) => ({ value: c as CountryFilter, label: c })),
                    ]}
                    value={country}
                    onChange={setCountry}
                    ariaLabel="Filter by country"
                  />
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {/* Always mounted — visibility only — so appearing doesn't
                      resize the chips row and snap the pill mid-glide. */}
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-sm text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink ${
                      hasFilters ? '' : 'invisible'
                    }`}
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                  <label className="relative">
                    <span className="sr-only">Filter by year</span>
                    <select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="cursor-pointer appearance-none rounded-full border border-border bg-transparent py-1 pl-3 pr-7 text-sm font-medium text-ink-2 transition-colors duration-150 hover:border-border-strong hover:text-ink"
                    >
                      <option value="all">Any year</option>
                      {years.map((y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
                  </label>
                </div>
              </div>
              {cityOptions.length > 1 && (
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className="w-14 shrink-0 pt-1.5 text-xs font-medium uppercase tracking-wide text-ink-3">
                    City
                  </span>
                  <div className="min-w-0 flex-1">
                    <Chips
                      options={[
                        { value: 'all' as CityFilter, label: 'All' },
                        ...cityOptions.map((c) => ({ value: c as CityFilter, label: c })),
                      ]}
                      value={city}
                      onChange={setCity}
                      ariaLabel="Filter by city"
                    />
                  </div>
                </div>
              )}
            </div>
            <Gallery
              key={`${year}-${country}-${city}`}
              doors={filtered}
              onSelect={setSelected}
              baseDelayMs={leaving && view === 'gallery' ? 150 : 0}
            />
          </div>
        </div>
      )}

      {/* Top bar — one persistent instance across both views, so the view
          switcher's pill glides instead of remounting. */}
      <header
        className="absolute inset-x-0 top-0 z-[500] flex h-16 items-center gap-4 border-b border-border bg-surface/75 px-4 backdrop-blur-md sm:px-6"
        style={{
          ['--rise-y' as string]: '-8px',
          animation: prefersReducedMotion()
            ? undefined
            : `rise-in 250ms ${POWER1_OUT_CSS} backwards`,
        }}
      >
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-3xl italic font-[400] tracking-[-0.04em] text-ink">
            DoorsWorld
          </h1>
        </div>
        <Segmented options={viewOptions} value={view} onChange={changeView} ariaLabel="View" />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <p className="hidden truncate text-sm text-ink-3 sm:block">
            {visibleDoors.length} {visibleDoors.length === 1 ? 'door' : 'doors'} ·{' '}
            {countryCount} {countryCount === 1 ? 'country' : 'countries'}
            {city !== 'all' && view === 'gallery' && (
              <> · {cityCount} {cityCount === 1 ? 'city' : 'cities'}</>
            )}
          </p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            aria-label="Add doors"
            title="Add doors"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
          >
            <Plus className="h-4 w-4" />
          </button>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
      </header>

      <AddDoor open={addOpen} onClose={() => setAddOpen(false)} sharedFiles={sharedFiles} />

      <DoorModal
        door={selected}
        doors={visibleDoors}
        onClose={() => setSelected(null)}
        onShowOnMap={handleShowOnMap}
        onNavigate={setSelected}
      />
    </div>
  );
}
