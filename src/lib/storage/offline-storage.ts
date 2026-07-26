/**
 * IndexedDB Storage Layer for Offline Route Caching
 * Respects browser storage limitations and map provider ToS
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { CachedRoute, OfflineRouteData, RouteGeometry } from '@/lib/types/route';

interface RouteCacheDB extends DBSchema {
  routes: {
    key: string;
    value: CachedRoute;
    indexes: { 'by-userId': string; 'by-lastAccessed': string };
  };
  routeGeometry: {
    key: string;
    value: RouteGeometry;
  };
}

const DB_NAME = 'TravellersOfflineCache';
const DB_VERSION = 1;

class OfflineStorage {
  private db: IDBPDatabase<RouteCacheDB> | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    this.db = await openDB<RouteCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Create routes store
        if (!db.objectStoreNames.contains('routes')) {
          const routeStore = db.createObjectStore('routes', { keyPath: 'id' });
          routeStore.createIndex('by-userId', 'userId');
          routeStore.createIndex('by-lastAccessed', 'lastAccessedAt');
        }

        // Create route geometry store
        if (!db.objectStoreNames.contains('routeGeometry')) {
          db.createObjectStore('routeGeometry', { keyPath: 'routeId' });
        }
      },
    });
  }

  async saveRoute(route: CachedRoute, geometry: RouteGeometry): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const tx = this.db.transaction(['routes', 'routeGeometry'], 'readwrite');
    
    await Promise.all([
      tx.objectStore('routes').put({
        ...route,
        cachedAt: route.cachedAt || new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      }),
      tx.objectStore('routeGeometry').put({
        routeId: route.id,
        ...geometry,
      } as any),
      tx.done,
    ]);
  }

  async getRoute(routeId: string): Promise<OfflineRouteData | null> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const tx = this.db.transaction(['routes', 'routeGeometry'], 'readwrite');
    
    const route = await tx.objectStore('routes').get(routeId);
    if (!route) return null;

    // Update last accessed time
    await tx.objectStore('routes').put({
      ...route,
      lastAccessedAt: new Date().toISOString(),
    });

    const geometry = await tx.objectStore('routeGeometry').get(routeId);
    if (!geometry) return null;

    return {
      metadata: route,
      geometry: {
        type: geometry.type,
        coordinates: geometry.coordinates,
      },
    };
  }

  async getRoutesByUser(userId: string): Promise<CachedRoute[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return this.db.getAllFromIndex('routes', 'by-userId', userId);
  }

  async getAllRoutes(): Promise<CachedRoute[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return this.db.getAll('routes');
  }

  async deleteRoute(routeId: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const tx = this.db.transaction(['routes', 'routeGeometry'], 'readwrite');
    
    await Promise.all([
      tx.objectStore('routes').delete(routeId),
      tx.objectStore('routeGeometry').delete(routeId),
      tx.done,
    ]);
  }

  async clearOldRoutes(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const cutoffDate = new Date(Date.now() - maxAge).toISOString();
    const routes = await this.db.getAll('routes');
    
    let deletedCount = 0;
    const tx = this.db.transaction(['routes', 'routeGeometry'], 'readwrite');
    
    for (const route of routes) {
  if (route.lastAccessedAt < cutoffDate && route.id) {
    await tx.objectStore("routes").delete(route.id);
    await tx.objectStore("routeGeometry").delete(route.id);
    deletedCount++;
  }
}
    
    await tx.done;
    return deletedCount;
  }

  async getStorageEstimate(): Promise<{ usage: number; quota: number; percentage: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentage = quota > 0 ? (usage / quota) * 100 : 0;
      
      return { usage, quota, percentage };
    }
    
    return { usage: 0, quota: 0, percentage: 0 };
  }
}

export const offlineStorage = new OfflineStorage();
