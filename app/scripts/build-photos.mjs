#!/usr/bin/env node
// Doors of the World - photo processing pipeline.
// Node ESM, builtins only. Run directly: node build-photos.mjs
// Scans read-only Assets/, extracts GPS/date/dimensions via `magick`,
// resolves GPS-less files, converts to WebP, reverse-geocodes via Nominatim,
// and emits app/src/data/doors.json.

import { execFileSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Paths (absolute) ---------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // DoorsWorld/
const ASSETS_DIR = path.join(PROJECT_ROOT, 'Assets');
const SCRIPTS_DIR = __dirname;
const OVERRIDES_PATH = path.join(SCRIPTS_DIR, 'overrides.json');
const CACHE_PATH = path.join(SCRIPTS_DIR, 'geocode-cache.json');
const PHOTOS_OUT_DIR = path.join(PROJECT_ROOT, 'app', 'public', 'photos');
const DATA_OUT_DIR = path.join(PROJECT_ROOT, 'app', 'src', 'data');
const DOORS_JSON_PATH = path.join(DATA_OUT_DIR, 'doors.json');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.heic']);

// --- Helpers ------------------------------------------------------------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

// Parse a single "a/b" rational into a number.
function rational(str) {
  const [a, b] = str.split('/');
  const num = Number(a);
  const den = b === undefined ? 1 : Number(b);
  if (!den) return 0;
  return num / den;
}

// Convert "d/1,m/1,s/scale" DMS + ref into signed decimal degrees.
function dmsToDecimal(dms, ref) {
  if (!dms) return null;
  const parts = dms.split(',');
  if (parts.length < 3) return null;
  const deg = rational(parts[0]);
  const min = rational(parts[1]);
  const sec = rational(parts[2]);
  let dec = deg + min / 60 + sec / 3600;
  const r = (ref || '').trim().toUpperCase();
  if (r === 'S' || r === 'W') dec = -dec;
  return dec;
}

// Parse "YYYY:MM:DD HH:MM:SS" EXIF datetime into a JS Date (local, no TZ info).
function parseExifDate(s) {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S] = m.map(Number);
  const d = new Date(Y, Mo - 1, D, H, Mi, S);
  if (isNaN(d.getTime())) return null;
  return d;
}

// Local ISO 8601 (keep wall-clock time from EXIF, with local offset).
function toIsoLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
  );
}

// Parse YYYYMMDD_HHMMSS from a filename base -> {day, seconds-since-epoch-ish}.
function parseFilenameTimestamp(base) {
  const m = base.match(/(\d{8})_(\d{6})/);
  if (!m) return null;
  const day = m[1];
  const t = m[2];
  const secs =
    Number(t.slice(0, 2)) * 3600 + Number(t.slice(2, 4)) * 60 + Number(t.slice(4, 6));
  return { day, secs };
}

// Strip trailing ~N suffix from a base filename (no extension).
function stripEditSuffix(base) {
  return base.replace(/~\d+$/, '');
}

function idFromBase(base) {
  return base.replace(/~/g, '-');
}

function sleep(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

function magick(args) {
  return execFileSync('magick', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// --- Nominatim reverse geocode -----------------------------------------
function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

function extractLabel(json) {
  const a = (json && json.address) || {};
  const city =
    a.city || a.town || a.village || a.municipality || a.hamlet || a.county || '';
  const country = a.country || '';
  const street = a.road || a.pedestrian || a.footway || '';
  const neighbourhood = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
  return { city, country, street, neighbourhood };
}

// --- Main ---------------------------------------------------------------
async function main() {
  ensureDir(PHOTOS_OUT_DIR);
  ensureDir(DATA_OUT_DIR);

  const overrides = readJson(OVERRIDES_PATH, {});
  const cache = readJson(CACHE_PATH, {});

  // 1. Scan + extract EXIF ------------------------------------------------
  const files = fs
    .readdirSync(ASSETS_DIR)
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort();

  const fmt =
    '%[EXIF:GPSLatitude]|%[EXIF:GPSLatitudeRef]|%[EXIF:GPSLongitude]|' +
    '%[EXIF:GPSLongitudeRef]|%[EXIF:DateTimeOriginal]|%w|%h';

  const photos = [];
  for (const file of files) {
    const src = path.join(ASSETS_DIR, file);
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    let out;
    try {
      out = magick(['identify', '-format', fmt, src]);
    } catch (e) {
      console.warn(`WARN: identify failed for ${file}: ${e.message.split('\n')[0]}`);
      continue;
    }
    const [latDms, latRef, lonDms, lonRef, dt, w, h] = out.trim().split('|');
    const lat = dmsToDecimal(latDms, latRef);
    const lon = dmsToDecimal(lonDms, lonRef);
    const date = parseExifDate(dt);
    photos.push({
      file,
      base,
      ext,
      src,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      date,
      srcW: Number(w) || null,
      srcH: Number(h) || null,
    });
  }

  // Index photos WITH coords by their stripped base and by day.
  const byStrippedBaseWithGps = new Map();
  const byDayWithGps = new Map();
  for (const p of photos) {
    if (p.lat == null || p.lon == null) continue;
    const stripped = stripEditSuffix(p.base);
    if (!byStrippedBaseWithGps.has(stripped)) byStrippedBaseWithGps.set(stripped, p);
    const ts = parseFilenameTimestamp(p.base);
    if (ts) {
      if (!byDayWithGps.has(ts.day)) byDayWithGps.set(ts.day, []);
      byDayWithGps.get(ts.day).push({ p, secs: ts.secs });
    }
  }

  // 2. Resolve GPS-less files --------------------------------------------
  const kept = [];
  const skippedDuplicates = [];
  const inferred = [];
  const excluded = [];

  for (const p of photos) {
    if (p.lat != null && p.lon != null) {
      kept.push(p);
      continue;
    }

    const stripped = stripEditSuffix(p.base);

    // (a) duplicate of an original WITH gps -> skip
    if (stripped !== p.base && byStrippedBaseWithGps.has(stripped)) {
      skippedDuplicates.push(p.file);
      continue;
    }

    // (b) nearest same-day photo with coords
    const ts = parseFilenameTimestamp(p.base);
    if (ts && byDayWithGps.has(ts.day)) {
      let best = null;
      let bestDiff = Infinity;
      for (const cand of byDayWithGps.get(ts.day)) {
        const diff = Math.abs(cand.secs - ts.secs);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = cand.p;
        }
      }
      if (best) {
        p.lat = best.lat;
        p.lon = best.lon;
        p.inferredFrom = best.file;
        inferred.push(p);
        kept.push(p);
        continue;
      }
    }

    // (c) overrides.json
    const ov = overrides[p.file];
    if (ov && Number.isFinite(ov.lat) && Number.isFinite(ov.lon)) {
      p.lat = ov.lat;
      p.lon = ov.lon;
      p.inferredFrom = 'override';
      inferred.push(p);
      kept.push(p);
      continue;
    }

    // (d) exclude
    excluded.push(p.file);
  }

  // 3. Convert kept photos to WebP ---------------------------------------
  for (const p of kept) {
    p.id = idFromBase(p.base);
    const thumbOut = path.join(PHOTOS_OUT_DIR, `${p.id}-thumb.webp`);
    const fullOut = path.join(PHOTOS_OUT_DIR, `${p.id}-full.webp`);

    const srcMtime = fs.statSync(p.src).mtimeMs;
    const upToDate =
      fs.existsSync(thumbOut) &&
      fs.existsSync(fullOut) &&
      fs.statSync(thumbOut).mtimeMs > srcMtime &&
      fs.statSync(fullOut).mtimeMs > srcMtime;

    if (!upToDate) {
      magick([p.src, '-auto-orient', '-strip', '-resize', '480x480>', '-quality', '82', thumbOut]);
      magick([p.src, '-auto-orient', '-strip', '-resize', '1600x1600>', '-quality', '82', fullOut]);
    }

    // Record actual full webp dimensions (post-orientation).
    const dim = magick(['identify', '-format', '%w|%h', fullOut]).trim().split('|');
    p.w = Number(dim[0]) || null;
    p.h = Number(dim[1]) || null;
  }

  // 4. Reverse geocode unique rounded coords -----------------------------
  const roundKey = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const uniqueKeys = new Map(); // key -> {lat, lon}
  for (const p of kept) {
    const key = roundKey(p.lat, p.lon);
    if (!uniqueKeys.has(key)) {
      uniqueKeys.set(key, { lat: Number(p.lat.toFixed(3)), lon: Number(p.lon.toFixed(3)) });
    }
  }

  const headers = { 'User-Agent': 'DoorsWorld/1.0 (personal art project)' };
  let fetched = 0;
  // `street` is undefined on cache entries from before street/neighbourhood
  // support — refetch those instead of leaving them incomplete.
  const toFetch = [...uniqueKeys.entries()].filter(([k]) => !cache[k] || cache[k].street === undefined);
  for (let i = 0; i < toFetch.length; i++) {
    const [key, { lat, lon }] = toFetch[i];
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lon}&zoom=18&accept-language=en`;
    if (fetched > 0) sleep(1100); // strictly < 1 req/sec
    try {
      const json = await httpsGetJson(url, headers);
      cache[key] = extractLabel(json);
    } catch (e) {
      console.warn(`WARN: geocode failed for ${key}: ${e.message.split('\n')[0]}`);
      cache[key] = { city: '', country: '', street: '', neighbourhood: '' };
    }
    fetched++;
    // incremental save
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  // 5. Emit doors.json ----------------------------------------------------
  const doors = kept.map((p) => {
    const key = roundKey(p.lat, p.lon);
    const label = cache[key] || { city: '', country: '', street: '', neighbourhood: '' };
    return {
      id: p.id,
      file: p.id,
      lat: Number(p.lat.toFixed(6)),
      lon: Number(p.lon.toFixed(6)),
      date: p.date ? toIsoLocal(p.date) : null,
      year: p.date ? p.date.getFullYear() : null,
      city: label.city,
      country: label.country,
      street: label.street,
      neighbourhood: label.neighbourhood,
      w: p.w,
      h: p.h,
    };
  });

  doors.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    return da < db ? -1 : da > db ? 1 : 0;
  });

  fs.writeFileSync(DOORS_JSON_PATH, JSON.stringify(doors, null, 2));

  // 6. Report -------------------------------------------------------------
  console.log('\n===== Doors of the World - build report =====');
  console.log(`Scanned:            ${photos.length}`);
  console.log(`Kept:               ${kept.length}`);
  console.log(`Skipped duplicates: ${skippedDuplicates.length}`);
  console.log(`Inferred location:  ${inferred.length}`);
  console.log(`Excluded:           ${excluded.length}`);
  console.log(`Geocode requests:   ${fetched} (unique coords: ${uniqueKeys.size}, cached: ${uniqueKeys.size - fetched})`);
  if (skippedDuplicates.length) console.log(`\nDuplicates skipped:\n  ${skippedDuplicates.join('\n  ')}`);
  if (inferred.length)
    console.log(`\nInferred:\n  ${inferred.map((p) => `${p.file} <- ${p.inferredFrom}`).join('\n  ')}`);
  if (excluded.length) console.log(`\nExcluded (no location):\n  ${excluded.join('\n  ')}`);
  console.log(`\ndoors.json entries: ${doors.length}`);
  console.log(`Unique countries:   ${new Set(doors.map((d) => d.country).filter(Boolean)).size}`);
  console.log(`Output: ${DOORS_JSON_PATH}`);
  console.log('=============================================\n');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
