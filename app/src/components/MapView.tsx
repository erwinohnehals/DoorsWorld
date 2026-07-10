import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { Door } from '../lib/types';
import type { Theme } from '../lib/useTheme';
import { prefersReducedMotion } from '../lib/easing';

export interface MapHandle {
  flyTo: (door: Door) => void;
  invalidateSize: () => void;
}

interface MapViewProps {
  doors: Door[];
  theme: Theme;
  onSelect: (door: Door) => void;
}

const TILE_URLS: Record<Theme, string> = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

const doorIcon = L.divIcon({
  className: 'door-pin-wrap',
  html: '<div class="door-pin"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const createClusterIcon = (cluster: L.MarkerCluster) =>
  L.divIcon({
    html: `<div>${cluster.getChildCount()}</div>`,
    className: 'door-cluster',
    iconSize: L.point(38, 38),
  });

/**
 * Plain Leaflet map, driven imperatively with refs (no react-leaflet). The
 * Leaflet instance is created once and kept alive for the component's lifetime
 * so it survives being hidden during the gallery view. Markers cluster via
 * leaflet.markercluster; the tile layer swaps with the theme.
 */
export const MapView = forwardRef<MapHandle, MapViewProps>(function MapView(
  { doors, theme, onSelect },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const initialFitDone = useRef(false);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
      maxZoom: 19,
      minZoom: 2,
    }).setView([50, 12], 5);
    mapRef.current = map;

    // Keep zoom controls clear of the top-left header card.
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      chunkedLoading: true,
      iconCreateFunction: createClusterIcon,
    });
    clusterRef.current = cluster;
    map.addLayer(cluster);

    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // Swap the tile layer with the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
    }
    tileRef.current = L.tileLayer(TILE_URLS[theme], {
      attribution: ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    tileRef.current.bringToBack();
  }, [theme]);

  // Rebuild markers when the filtered doors change; fit to their bounds.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;

    cluster.clearLayers();
    const markers: L.Marker[] = doors.map((door) => {
      const m = L.marker([door.lat, door.lon], { icon: doorIcon });
      m.on('click', () => onSelectRef.current(door));
      return m;
    });
    cluster.addLayers(markers);

    if (doors.length > 0) {
      const bounds = L.latLngBounds(doors.map((d) => [d.lat, d.lon] as [number, number]));
      if (initialFitDone.current) {
        map.fitBounds(bounds, { padding: [70, 70], maxZoom: 14, animate: true });
      } else {
        initialFitDone.current = true;
      }
    }
  }, [doors]);

  useImperativeHandle(ref, () => ({
    flyTo: (door: Door) => {
      const map = mapRef.current;
      if (!map) return;
      if (prefersReducedMotion()) {
        map.setView([door.lat, door.lon], 16);
      } else {
        map.flyTo([door.lat, door.lon], 16, { duration: 1.1 });
      }
    },
    invalidateSize: () => {
      mapRef.current?.invalidateSize();
    },
  }));

  return <div ref={containerRef} className="h-full w-full" />;
});
