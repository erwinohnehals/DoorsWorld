// In-browser port of scripts/build-photos.mjs for single-photo ingest:
// EXIF GPS/date via exifr, WebP thumb/full via canvas, reverse geocode via
// Nominatim (same rounding + zoom as the pipeline, cache in localStorage).

import exifr from 'exifr';
import type { Door } from './types';

export interface AnalyzedPhoto {
  /** Original file, kept for naming fallbacks. */
  file: File;
  lat: number | null;
  lon: number | null;
  date: Date | null;
  thumb: Blob;
  full: Blob;
  /** Full-derivative pixel dimensions (post-orientation). */
  w: number;
  h: number;
  city: string;
  country: string;
  street: string;
  neighbourhood: string;
}

const THUMB_MAX = 480;
const FULL_MAX = 1600;
const WEBP_QUALITY = 0.82;

const GEOCODE_CACHE_KEY = 'doorsworld-geocode-cache';
// Nominatim policy: max 1 req/s. Ingest is sequential, so a timestamp gate
// on the last request is enough.
let lastGeocodeAt = 0;

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      `Can't decode ${file.name} in this browser` +
        (/\.hei[cf]$/i.test(file.name) || file.type.includes('hei')
          ? ' (HEIC). Share or export it as JPEG instead.'
          : '.'),
    );
  }
}

async function toWebp(bitmap: ImageBitmap, max: number): Promise<{ blob: Blob; w: number; h: number }> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  return { blob, w, h };
}

interface GeocodeLabel {
  city: string;
  country: string;
  street: string;
  neighbourhood: string;
}

/** Reverse geocode via Nominatim; same rounded key + labels as the pipeline. */
export async function geocode(lat: number, lon: number): Promise<GeocodeLabel> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  let cache: Record<string, GeocodeLabel> = {};
  try {
    cache = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
  } catch {
    /* corrupt cache — refetch */
  }
  // `street` is undefined on cache entries from before street/neighbourhood
  // support — refetch those instead of returning a stale, incomplete label.
  if (cache[key]?.street !== undefined) return cache[key];

  const wait = lastGeocodeAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocodeAt = Date.now();

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&zoom=18&accept-language=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);
  const json = await res.json();
  const a = json?.address ?? {};
  const label: GeocodeLabel = {
    city: a.city || a.town || a.village || a.municipality || a.hamlet || a.county || '',
    country: a.country || '',
    street: a.road || a.pedestrian || a.footway || '',
    neighbourhood: a.suburb || a.neighbourhood || a.quarter || a.city_district || '',
  };
  cache[key] = label;
  localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  return label;
}

/** Extract GPS + date and build the WebP derivatives for one photo. */
export async function analyzePhoto(file: File): Promise<AnalyzedPhoto> {
  const [gps, tags] = await Promise.all([
    exifr.gps(file).catch(() => null),
    exifr.parse(file, ['DateTimeOriginal', 'CreateDate']).catch(() => null),
  ]);
  const lat = Number.isFinite(gps?.latitude) ? (gps!.latitude as number) : null;
  const lon = Number.isFinite(gps?.longitude) ? (gps!.longitude as number) : null;
  const rawDate = tags?.DateTimeOriginal ?? tags?.CreateDate ?? null;
  const date = rawDate instanceof Date && !isNaN(rawDate.getTime()) ? rawDate : null;

  const bitmap = await decode(file);
  try {
    const full = await toWebp(bitmap, FULL_MAX);
    const thumb = await toWebp(bitmap, THUMB_MAX);
    let city = '';
    let country = '';
    let street = '';
    let neighbourhood = '';
    if (lat != null && lon != null) {
      try {
        ({ city, country, street, neighbourhood } = await geocode(lat, lon));
      } catch {
        /* leave empty, same as the pipeline on geocode failure */
      }
    }
    return {
      file,
      lat,
      lon,
      date,
      thumb: thumb.blob,
      full: full.blob,
      w: full.w,
      h: full.h,
      city,
      country,
      street,
      neighbourhood,
    };
  } finally {
    bitmap.close();
  }
}

/** Local ISO 8601 with offset, matching toIsoLocal in build-photos.mjs. */
export function toIsoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
  );
}

/** Pipeline-style id: YYYYMMDD_HHMMSS from EXIF date, else the filename base,
 *  else a timestamp; suffixed -2, -3… until unique among `taken`. */
export function makeId(photo: Pick<AnalyzedPhoto, 'file' | 'date'>, taken: Set<string>): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  let base: string;
  if (photo.date) {
    const d = photo.date;
    base =
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  } else {
    base = photo.file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!base) base = `door-${Date.now()}`;
  }
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Assemble the doors.json entry (id must come from makeId). */
export function buildDoor(id: string, p: AnalyzedPhoto): Door {
  if (p.lat == null || p.lon == null) throw new Error('buildDoor requires coordinates');
  return {
    id,
    file: id,
    lat: Number(p.lat.toFixed(6)),
    lon: Number(p.lon.toFixed(6)),
    date: p.date ? toIsoLocal(p.date) : null,
    year: p.date ? p.date.getFullYear() : null,
    city: p.city,
    country: p.country,
    street: p.street,
    neighbourhood: p.neighbourhood,
    w: p.w,
    h: p.h,
  };
}
