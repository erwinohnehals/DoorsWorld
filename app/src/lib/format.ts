import type { Door } from './types';

/** "25 October 2022" */
export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "Kokořín, Czechia" — drops empty parts gracefully. */
export function placeLabel(door: Pick<Door, 'city' | 'country'>): string {
  const parts = [door.city, door.country].map((s) => (s || '').trim()).filter(Boolean);
  return parts.join(', ') || 'Unknown location';
}

/** "50.4446, 14.4235" */
export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/** URL of a door photo derivative, honouring the deploy base path. */
export function photoUrl(file: string, kind: 'thumb' | 'full'): string {
  return `${import.meta.env.BASE_URL}photos/${file}-${kind}.webp`;
}
