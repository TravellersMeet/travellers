/**
 * Route and Location Types for Offline-First Travel Mode
 */

export interface Location {
  lat: number;
  lng: number;
}

export interface RouteWaypoint {
  location: Location;
  stopover: boolean;
  name?: string;
}

export interface RouteMetadata {
  id?: string;
  userId: string;
  origin: Location;
  destination: Location;
  waypoints?: RouteWaypoint[];
  originName?: string;
  destinationName?: string;
  distance: number; // in meters
  duration: number; // in seconds
  encodedPolyline: string;
  createdAt: string;
  updatedAt: string;
  tripName?: string;
  notes?: string;
}

export interface CachedRoute extends RouteMetadata {
  cachedAt: string;
  lastAccessedAt: string;
}

export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][]; // [lng, lat] pairs
}

export interface OfflineRouteData {
  metadata: CachedRoute;
  geometry: RouteGeometry;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}
