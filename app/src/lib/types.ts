// Shape of each entry in src/data/doors.json (emitted by scripts/build-photos.mjs).
export interface Door {
  id: string;
  /** Base used to build /photos/<file>-thumb.webp and /photos/<file>-full.webp */
  file: string;
  lat: number;
  lon: number;
  /** ISO 8601 date-time, or null if EXIF had no date. */
  date: string | null;
  year: number | null;
  city: string;
  country: string;
  /** Street name, e.g. "Karlova". Empty/absent where Nominatim has no road at this point. */
  street?: string;
  /** Suburb/quarter, e.g. "Staré Město". Empty/absent where Nominatim has none. */
  neighbourhood?: string;
  /** Full webp pixel dimensions (for aspect ratio). */
  w: number | null;
  h: number | null;
}
