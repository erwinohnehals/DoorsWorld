import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Check, ImagePlus, Loader2, MapPin, Trash2, X } from 'lucide-react';
import type { Door } from '../lib/types';
import { STANDARD_EASE_CSS } from '../lib/easing';
import { formatDate, placeLabel } from '../lib/format';
import { analyzePhoto, buildDoor, geocode, makeId, toIsoLocal, type AnalyzedPhoto } from '../lib/ingest';
import {
  DOORS_JSON_PATH,
  PHOTOS_DIR,
  blobToBase64,
  clearToken,
  commitFiles,
  fetchLiveDoors,
  getToken,
  setToken,
  verifyToken,
} from '../lib/github';

interface AddDoorProps {
  open: boolean;
  onClose: () => void;
  /** Files handed over from the Android share sheet, if any. */
  sharedFiles: File[] | null;
}

interface Item {
  key: number;
  file: File;
  status: 'processing' | 'ready' | 'needs-pin' | 'error';
  error?: string;
  photo?: AnalyzedPhoto;
  previewUrl?: string;
}

type Phase = 'edit' | 'committing' | 'done';

let nextKey = 1;

/** Mini Leaflet map for photos without GPS: tap to drop the pin. */
function PinPicker({
  onPick,
  onCancel,
}: {
  onPick: (lat: number, lon: number) => void;
  onCancel: () => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  useEffect(() => {
    if (!divRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, minZoom: 2 }).setView([50, 12], 4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      maxZoom: 19,
    }).addTo(map);
    let marker: L.Marker | null = null;
    const icon = L.divIcon({
      className: 'door-pin-wrap',
      html: '<div class="door-pin"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!marker) marker = L.marker(e.latlng, { icon }).addTo(map);
      else marker.setLatLng(e.latlng);
      setPicked({ lat: e.latlng.lat, lon: e.latlng.lng });
    });
    return () => {
      map.remove();
    };
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-sm text-ink-2">
        This photo has no GPS data — tap the map where you found the door.
      </p>
      <div ref={divRef} className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border" />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!picked}
          onClick={() => picked && onPick(picked.lat, picked.lon)}
        >
          <MapPin className="h-4 w-4" />
          Use this location
        </button>
      </div>
    </div>
  );
}

/**
 * "Add doors" modal: pick photos (or receive them from the share sheet),
 * analyze in-browser (EXIF → WebP → reverse geocode), then commit everything
 * to GitHub in one commit; Pages redeploys the site with the new doors.
 */
export function AddDoor({ open, onClose, sharedFiles }: AddDoorProps) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [tokenChecking, setTokenChecking] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>('edit');
  const [commitError, setCommitError] = useState('');
  const [doneCount, setDoneCount] = useState(0);
  const [pinFor, setPinFor] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // Serializes analysis so a big multi-share doesn't decode everything at once.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const importedShareRef = useRef<File[] | null>(null);

  const updateItem = (key: number, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    setPhase('edit');
    setCommitError('');
    const newItems: Item[] = files.map((file) => ({ key: nextKey++, file, status: 'processing' }));
    setItems((prev) => [...prev, ...newItems]);
    for (const item of newItems) {
      queueRef.current = queueRef.current.then(async () => {
        try {
          const photo = await analyzePhoto(item.file);
          updateItem(item.key, {
            photo,
            previewUrl: URL.createObjectURL(photo.thumb),
            status: photo.lat != null && photo.lon != null ? 'ready' : 'needs-pin',
          });
        } catch (e) {
          updateItem(item.key, { status: 'error', error: (e as Error).message });
        }
      });
    }
  };

  // Shared files arrive once per share; import them when the modal opens.
  useEffect(() => {
    if (open && sharedFiles && sharedFiles.length && importedShareRef.current !== sharedFiles) {
      importedShareRef.current = sharedFiles;
      addFiles(sharedFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sharedFiles]);

  // Esc closes (except mid-commit).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'committing') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, onClose]);

  const removeItem = (key: number) => {
    setItems((prev) => {
      const it = prev.find((i) => i.key === key);
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
  };

  const resetAll = () => {
    setItems((prev) => {
      prev.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
      return [];
    });
    setPhase('edit');
    setCommitError('');
    setPinFor(null);
  };

  const saveToken = async () => {
    const t = tokenInput.trim();
    if (!t) return;
    setTokenChecking(true);
    setTokenError('');
    const ok = await verifyToken(t);
    setTokenChecking(false);
    if (!ok) {
      setTokenError('Token rejected — it needs Contents read & write access to this repository.');
      return;
    }
    setToken(t);
    setTokenState(t);
    setTokenInput('');
  };

  const handlePin = async (key: number, lat: number, lon: number) => {
    setPinFor(null);
    const item = items.find((i) => i.key === key);
    if (!item?.photo) return;
    let city = '';
    let country = '';
    try {
      ({ city, country } = await geocode(lat, lon));
    } catch {
      /* keep empty labels */
    }
    updateItem(key, { photo: { ...item.photo, lat, lon, city, country }, status: 'ready' });
  };

  const readyItems = items.filter((i) => i.status === 'ready');
  const busy = items.some((i) => i.status === 'processing');

  const commit = async () => {
    if (!token || !readyItems.length) return;
    setPhase('committing');
    setCommitError('');
    try {
      const live = await fetchLiveDoors(token);
      const taken = new Set(live.map((d) => d.id));
      const newDoors: Door[] = [];
      const files = [];
      for (const item of readyItems) {
        const photo = item.photo!;
        const id = makeId(photo, taken);
        newDoors.push(buildDoor(id, photo));
        files.push({ path: `${PHOTOS_DIR}/${id}-thumb.webp`, base64: await blobToBase64(photo.thumb) });
        files.push({ path: `${PHOTOS_DIR}/${id}-full.webp`, base64: await blobToBase64(photo.full) });
      }
      const all = [...live, ...newDoors].sort((a, b) => {
        const da = a.date || '';
        const db = b.date || '';
        return da < db ? -1 : da > db ? 1 : 0;
      });
      files.push({ path: DOORS_JSON_PATH, text: JSON.stringify(all, null, 2) });
      await commitFiles(
        token,
        files,
        `feat(data): add ${newDoors.length} door${newDoors.length === 1 ? '' : 's'} via app ingest`,
      );
      setDoneCount(newDoors.length);
      resetAll();
      setPhase('done');
    } catch (e) {
      setPhase('edit');
      setCommitError((e as Error).message);
    }
  };

  if (!open) return null;

  const pinItem = pinFor != null ? items.find((i) => i.key === pinFor) : null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 sm:p-6"
      style={{ animation: `modal-backdrop-in 240ms ${STANDARD_EASE_CSS}` }}
      onClick={() => phase !== 'committing' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Add doors"
    >
      <div
        className="card flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-border-strong shadow-2xl"
        style={{ animation: `modal-panel-in 320ms ${STANDARD_EASE_CSS}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Add doors</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'committing'}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2/80 text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* ── Token setup ─────────────────────────────────────────────── */}
          {!token && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-2">
                Adding doors commits them straight to the GitHub repository, so this device needs
                a{' '}
                <a
                  className="underline decoration-ink-3 underline-offset-2 hover:text-ink"
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  fine-grained personal access token
                </a>{' '}
                — repository access: <strong>only DoorsWorld</strong>, permissions:{' '}
                <strong>Contents → read &amp; write</strong>. It's stored only in this browser.
              </p>
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="github_pat_…"
                autoComplete="off"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-border-strong focus:outline-none"
              />
              {tokenError && <p className="text-sm text-red-500">{tokenError}</p>}
              <button
                type="button"
                className="btn btn-primary self-end disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!tokenInput.trim() || tokenChecking}
                onClick={saveToken}
              >
                {tokenChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save token
              </button>
            </div>
          )}

          {/* ── Pin picker ──────────────────────────────────────────────── */}
          {token && pinItem && (
            <div className="h-[60vh]">
              <PinPicker
                onCancel={() => setPinFor(null)}
                onPick={(lat, lon) => handlePin(pinItem.key, lat, lon)}
              />
            </div>
          )}

          {/* ── Done ────────────────────────────────────────────────────── */}
          {token && !pinItem && phase === 'done' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Check className="h-6 w-6" />
              </div>
              <p className="font-medium text-ink">
                {doneCount} door{doneCount === 1 ? '' : 's'} committed
              </p>
              <p className="max-w-sm text-sm text-ink-2">
                The site is rebuilding — the new door{doneCount === 1 ? '' : 's'} will appear here
                in a couple of minutes.
              </p>
              <button type="button" className="btn btn-secondary mt-2" onClick={() => setPhase('edit')}>
                <ImagePlus className="h-4 w-4" />
                Add more
              </button>
            </div>
          )}

          {/* ── Photo list / picker ─────────────────────────────────────── */}
          {token && !pinItem && phase !== 'done' && (
            <div className="flex flex-col gap-3">
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              {items.length === 0 && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-10 text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
                >
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-sm font-medium">Choose photos</span>
                  <span className="text-xs text-ink-3">
                    Tip: you can also share photos here from Google Photos once the app is
                    installed.
                  </span>
                </button>
              )}

              {items.map((item) => (
                <div key={item.key} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-surface-3">
                    {item.previewUrl && (
                      <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {item.status === 'processing' && (
                      <p className="flex items-center gap-2 text-sm text-ink-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Analyzing {item.file.name}…
                      </p>
                    )}
                    {item.status === 'ready' && item.photo && (
                      <>
                        <p className="truncate text-sm font-medium text-ink">
                          {placeLabel(item.photo)}
                        </p>
                        <p className="truncate text-xs text-ink-3">
                          {item.photo.date ? formatDate(toIsoLocal(item.photo.date)) : 'No date'}
                        </p>
                      </>
                    )}
                    {item.status === 'needs-pin' && (
                      <>
                        <p className="truncate text-sm font-medium text-ink">{item.file.name}</p>
                        <button
                          type="button"
                          onClick={() => setPinFor(item.key)}
                          className="mt-0.5 flex items-center gap-1 text-xs font-medium text-accent-hover hover:underline"
                        >
                          <MapPin className="h-3 w-3" />
                          No GPS — set location on map
                        </button>
                      </>
                    )}
                    {item.status === 'error' && (
                      <p className="text-xs text-red-500">{item.error}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    disabled={phase === 'committing'}
                    aria-label={`Remove ${item.file.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {commitError && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  {commitError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        {token && !pinItem && phase !== 'done' && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={() => {
                clearToken();
                setTokenState(null);
              }}
              className="text-xs text-ink-3 hover:text-ink hover:underline"
            >
              Change token
            </button>
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => inputRef.current?.click()}
                  disabled={phase === 'committing'}
                >
                  <ImagePlus className="h-4 w-4" />
                  Add more
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40"
                disabled={readyItems.length === 0 || busy || phase === 'committing'}
                onClick={commit}
              >
                {phase === 'committing' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {phase === 'committing'
                  ? 'Committing…'
                  : `Commit ${readyItems.length || ''} door${readyItems.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
