'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Map,
  Marker,
  NavigationControl,
  Source,
  Layer,
} from "@vis.gl/react-maplibre";
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Location, RouteWaypoint } from '@/lib/types/route';
import { getRoute } from '@/lib/utils/osrm';

console.log("Map:", Map);
console.log("Marker:", Marker);
console.log("Source:", Source);
console.log("Layer:", Layer);
console.log("NavigationControl:", NavigationControl);

console.log({
  Map,
  Marker,
  NavigationControl,
  Source,
  Layer,
});

interface MapLibreRouteProps {
  origin: Location;
  destination: Location;
  waypoints?: RouteWaypoint[];
  onRouteCalculated?: (route: {
    distance: number;
    duration: number;
    encodedPolyline: string;
  }) => void;
  className?: string;
}

export function MapLibreRoute({
  origin,
  destination,
  onRouteCalculated,
  className = '',
}: MapLibreRouteProps) {
  const [coordinates, setCoordinates] = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadRoute() {
      try {
        setLoading(true);
        setError('');

        const route = await getRoute(origin, destination);
        console.log("ROUTE:",route);

        setCoordinates(route.coordinates);

        onRouteCalculated?.({
          distance: route.distance,
          duration: route.duration,
          encodedPolyline: route.encodedPolyline,
        });
      } catch (err) {
        console.error("OSRM ERROR:", err);
        setError('Unable to calculate route');
      } finally {
        setLoading(false);
      }
    }

    loadRoute();
  }, [origin, destination, onRouteCalculated]);

  const geoJson = useMemo(
  () => ({
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates,
    },
  }),
  [coordinates]
);

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 ${className}`}
      >
        Loading Route...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 ${className}`}
      >
        {error}
      </div>
    );
  }

  return (
  <Map
    initialViewState={{
      longitude: (origin.lng + destination.lng) / 2,
      latitude: (origin.lat + destination.lat) / 2,
      zoom: 6,
    }}
    style={{
      width: "100%",
      height: "100%",
    }}
    mapStyle="https://demotiles.maplibre.org/style.json"
  >
    <NavigationControl position="top-right" />

    <Marker longitude={origin.lng} latitude={origin.lat} />

    <Marker
      longitude={destination.lng}
      latitude={destination.lat}
    />

    <Source
      id="route"
      type="geojson"
      data={geoJson}
    >
      <Layer
        id="route-line"
        type="line"
        paint={{
          "line-color": "#2563eb",
          "line-width": 5,
        }}
      />
    </Source>
  </Map>
);
}