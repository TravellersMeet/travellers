/**
 * Route Cache Manager Utility
 * Handles caching and syncing of route data
 */

import { offlineStorage } from '../storage/offline-storage';
import type { RouteMetadata, CachedRoute, OfflineRouteData, RouteGeometry } from '@/lib/types/route';

/**
 * Decode Google Maps encoded polyline to coordinates
 */
export function decodePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
}

/**
 * Encode coordinates to Google Maps polyline format
 */
export function encodePolyline(coordinates: [number, number][]): string {
  const encode = (num: number): string => {
    let encoded = '';
    num = Math.round(num * 1e5);
    num = num < 0 ? ~(num << 1) : num << 1;

    while (num >= 0x20) {
      encoded += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
      num >>= 5;
    }

    encoded += String.fromCharCode(num + 63);
    return encoded;
  };

  let prevLat = 0;
  let prevLng = 0;
  let encoded = '';

  for (const [lng, lat] of coordinates) {
    const roundedLat = Math.round(lat * 1e5);
    const roundedLng = Math.round(lng * 1e5);

    encoded += encode(roundedLat - prevLat);
    encoded += encode(roundedLng - prevLng);

    prevLat = roundedLat;
    prevLng = roundedLng;
  }

  return encoded;
}

class RouteCacheManager {
  /**
   * Save a route to offline cache
   */
  async cacheRoute(route: RouteMetadata): Promise<void> {
    const geometry: RouteGeometry = {
      type: 'LineString',
      coordinates: decodePolyline(route.encodedPolyline),
    };

    const cachedRoute: CachedRoute = {
      ...route,
      cachedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };

    await offlineStorage.saveRoute(cachedRoute, geometry);
  }

  /**
   * Get a cached route
   */
  async getCachedRoute(routeId: string): Promise<OfflineRouteData | null> {
    return offlineStorage.getRoute(routeId);
  }

  /**
   * Get all routes for a user
   */
  async getUserRoutes(userId: string): Promise<CachedRoute[]> {
    return offlineStorage.getRoutesByUser(userId);
  }

  /**
   * Get all cached routes
   */
  async getAllCachedRoutes(): Promise<CachedRoute[]> {
    return offlineStorage.getAllRoutes();
  }

  /**
   * Delete a cached route
   */
  async deleteCachedRoute(routeId: string): Promise<void> {
    await offlineStorage.deleteRoute(routeId);
  }

  /**
   * Sync route with server (when online)
   */
  async syncRoute(route: RouteMetadata): Promise<void> {
  const response = await fetch('/api/routes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(route),
  });

  const data = await response.json();

  console.log("SERVER RESPONSE:", data);

  if (!response.ok) {
    throw new Error(data.error || "Failed to save route");
  }

  console.log("ROUTE BEING CACHED:", route);
  await this.cacheRoute({
  ...route,
  id: data.id,
});
  }
  /**
   * Load route from server and cache
   */
  async fetchAndCacheRoute(routeId: string): Promise<OfflineRouteData | null> {
    try {
      const response = await fetch(`/api/routes/${routeId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch route from server');
      }

      const route: RouteMetadata = await response.json();
      await this.cacheRoute(route);
      
      return this.getCachedRoute(routeId);
    } catch (error) {
      console.error('Failed to fetch route:', error);
      // Try to get from cache
      return this.getCachedRoute(routeId);
    }
  }

  /**
   * Clean up old routes to free storage
   */
  async cleanupOldRoutes(maxAgeInDays: number = 30): Promise<number> {
    const maxAgeMs = maxAgeInDays * 24 * 60 * 60 * 1000;
    return offlineStorage.clearOldRoutes(maxAgeMs);
  }

  /**
   * Get storage usage information
   */
  async getStorageInfo() {
    return offlineStorage.getStorageEstimate();
  }

  /**
   * Format distance for display
   */
  formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  }

  /**
   * Format duration for display
   */
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}

export const routeCacheManager = new RouteCacheManager();
