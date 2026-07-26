'use client';

import React, { useState, useEffect } from 'react';
import { demoRoutes } from '@/lib/data/demo-routes';
import { OfflineRouteRenderer } from '@/components/offline-route-renderer';
import { routeCacheManager, decodePolyline } from '@/lib/utils/route-cache-manager';
import type { RouteMetadata } from '@/lib/types/route';

export default function DemoRoutesPage() {
  const [selectedRoute, setSelectedRoute] = useState<RouteMetadata | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<RouteMetadata[]>([]);

  useEffect(() => {
    // Load any previously saved demo routes
    loadSavedRoutes();
  }, []);

  const loadSavedRoutes = async () => {
    try {
      const routes = await routeCacheManager.getUserRoutes('demo-user');
      setSavedRoutes(routes);
    } catch (error) {
      console.error('Error loading saved routes:', error);
    }
  };

  const handleSaveRoute = async (route: RouteMetadata) => {
    try {
      await routeCacheManager.cacheRoute(route);
      alert(`✅ "${route.tripName}" saved to offline storage!`);
      await loadSavedRoutes();
    } catch (error) {
      console.error('Error saving route:', error);
      alert('❌ Failed to save route');
    }
  };

  const handleDeleteRoute = async (routeId: string) => {
    try {
      await routeCacheManager.deleteCachedRoute(routeId);
      alert('🗑️ Route deleted from IndexedDB');
      await loadSavedRoutes();
      if (selectedRoute?.id === routeId) {
        setSelectedRoute(null);
      }
    } catch (error) {
      console.error('Error deleting route:', error);
      alert('❌ Failed to delete route');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">🗺️ Demo Routes (No API Key Required)</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Test the offline route visualization without Google Maps API. 
          Routes are rendered using pure SVG and stored in IndexedDB.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Route List */}
        <div className="lg:col-span-1 space-y-4">
          <div>
            <h2 className="text-xl font-semibold mb-3">📋 Demo Routes</h2>
            <div className="space-y-2">
              {demoRoutes.map((route) => (
                <div
                  key={route.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    selectedRoute?.id === route.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                  }`}
                  onClick={() => setSelectedRoute(route)}
                >
                  <div className="font-semibold">{route.tripName}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {route.originName} → {route.destinationName}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {routeCacheManager.formatDistance(route.distance)} • {routeCacheManager.formatDuration(route.duration)}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveRoute(route);
                    }}
                    className="mt-2 text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                  >
                    💾 Save to IndexedDB
                  </button>
                </div>
              ))}
            </div>
          </div>

          {savedRoutes.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-3">💾 Saved Routes</h2>
              <div className="space-y-2">
                {savedRoutes.map((route) => (
                  <div
                    key={route.id}
                    className="p-3 border border-green-500 bg-green-50 dark:bg-green-900/20 rounded-lg"
                  >
                    <div className="font-medium text-sm">{route.tripName}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                      Saved in IndexedDB
                    </div>
                    <button
                      onClick={() => {
  if (route.id) {
    handleDeleteRoute(route.id);
  }
}}
                      className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Route Visualization */}
        <div className="lg:col-span-2">
          {selectedRoute ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="mb-4">
                <h2 className="text-2xl font-bold">{selectedRoute.tripName}</h2>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 dark:text-gray-400">
                  <span>🚗 {routeCacheManager.formatDistance(selectedRoute.distance)}</span>
                  <span>⏱️ {routeCacheManager.formatDuration(selectedRoute.duration)}</span>
                </div>
                {selectedRoute.notes && (
                  <p className="mt-2 text-sm italic">{selectedRoute.notes}</p>
                )}
              </div>

              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <OfflineRouteRenderer 
                  geometry={{
                    type: 'LineString',
                    coordinates: decodePolyline(selectedRoute.encodedPolyline),
                  }}
                  origin={selectedRoute.origin}
                  destination={selectedRoute.destination}
                />
              </div>

              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                <div className="font-semibold text-sm mb-2">📍 Route Details:</div>
                <div className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
                  <div><strong>Origin:</strong> {selectedRoute.originName} ({selectedRoute.origin.lat.toFixed(4)}, {selectedRoute.origin.lng.toFixed(4)})</div>
                  <div><strong>Destination:</strong> {selectedRoute.destinationName} ({selectedRoute.destination.lat.toFixed(4)}, {selectedRoute.destination.lng.toFixed(4)})</div>
                  <div><strong>Polyline Points:</strong> {decodePolyline(selectedRoute.encodedPolyline).length}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-12 text-center text-gray-500">
              <div className="text-4xl mb-4">🗺️</div>
              <p>Select a route from the list to view it</p>
            </div>
          )}
        </div>
      </div>

      {/* Testing Instructions */}
      <div className="mt-8 p-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
        <h3 className="font-bold mb-3">🧪 Testing Instructions (No Google Maps API Required)</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li><strong>View Routes:</strong> Click any route in the list to see SVG visualization</li>
          <li><strong>Save to IndexedDB:</strong> Click &quot;💾 Save to IndexedDB&quot; on any route</li>
          <li><strong>Check Storage:</strong> Open DevTools → Application → IndexedDB → TravellersOfflineCache</li>
          <li><strong>Test Offline:</strong> Go offline (DevTools Network tab → Offline), refresh page, routes still load!</li>
          <li><strong>Delete Routes:</strong> Click &quot;🗑️ Delete&quot; to remove from IndexedDB</li>
        </ol>
        <div className="mt-4 p-3 bg-white dark:bg-gray-800 rounded text-xs">
          <strong>Why this works without Google Maps:</strong> The routes use pre-calculated polylines (encoded route paths). 
          The OfflineRouteRenderer converts these to SVG paths, so no external API is needed!
        </div>
      </div>
    </div>
  );
}
