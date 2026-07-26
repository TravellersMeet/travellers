/**
 * Route Viewer Component
 * Switches between online Google Maps and offline SVG rendering
 */

'use client';

import React, { useState, useEffect } from 'react';
import { MapLibreRoute } from './maplibre-route';
import { OfflineRouteRenderer } from './offline-route-renderer';
import { OfflineModeIndicator } from './offline-mode-indicator';
import { useConnectivity } from '@/lib/hooks/useConnectivity';
import { routeCacheManager } from '@/lib/utils/route-cache-manager';
import type { OfflineRouteData, RouteMetadata } from '@/lib/types/route';
import { Download, Save, Trash2, MapPin } from "lucide-react";

interface RouteViewerProps {
  routeId?: string;
  initialRoute?: RouteMetadata;
  allowCaching?: boolean;
  showControls?: boolean;
}

export function RouteViewer({
  routeId,
  initialRoute,
  allowCaching = true,
  showControls = true,
}: RouteViewerProps) {
  const { isOnline } = useConnectivity();
  const [route, setRoute] = useState<OfflineRouteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCached, setIsCached] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load route data
  useEffect(() => {
    async function loadRoute() {
      setIsLoading(true);
      setError(null);

      try {
        if (initialRoute) {
  await routeCacheManager.cacheRoute(initialRoute);

  if (initialRoute.id) {
    const cachedData = await routeCacheManager.getCachedRoute(initialRoute.id);

    if (cachedData) {
      setRoute(cachedData);
      setIsCached(true);
    }
  }
}
        else if (routeId) {
          // Load from cache first
          const cachedData = await routeCacheManager.getCachedRoute(routeId);
          
          if (cachedData) {
            setRoute(cachedData);
            setIsCached(true);
            
            // Try to fetch fresh data if online
            if (isOnline) {
              try {
                const freshData = await routeCacheManager.fetchAndCacheRoute(routeId);
                if (freshData) {
                  setRoute(freshData);
                }
              } catch (err) {
                console.error('Failed to fetch fresh route data:', err);
              }
            }
          } else if (isOnline) {
            // Fetch from server
            const fetchedData = await routeCacheManager.fetchAndCacheRoute(routeId);
            if (fetchedData) {
              setRoute(fetchedData);
              setIsCached(true);
            } else {
              setError('Route not found');
            }
          } else {
            setError('Route not available offline');
          }
        }
      } catch (err) {
        console.error('Error loading route:', err);
        setError('Failed to load route');
      } finally {
        setIsLoading(false);
      }
    }

    loadRoute();
  }, [routeId, initialRoute, isOnline]);

  const handleRouteCalculated = async (calculatedRoute: {
    distance: number;
    duration: number;
    encodedPolyline: string;
  }) => {
    if (!route || !allowCaching) return;

    // Update route with calculated data
    const updatedRoute: RouteMetadata = {
      ...route.metadata,
      ...calculatedRoute,
    };

    await routeCacheManager.cacheRoute(updatedRoute);
    setIsCached(true);
  };

  const handleSaveForOffline = async () => {
    if (!route) return;

    try {
      await routeCacheManager.syncRoute(route.metadata);
      alert('Route saved for offline access!');
    } catch (err) {
      console.error('Failed to save route:', err);
      alert('Failed to save route');
    }
  };

  const handleDeleteCache = async () => {
    if (!route || !routeId) return;

    if (confirm('Remove this route from offline storage?')) {
      try {
        await routeCacheManager.deleteCachedRoute(routeId);
        setIsCached(false);
        alert('Route removed from offline storage');
      } catch (err) {
        console.error('Failed to delete route:', err);
        alert('Failed to delete route');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading route...</p>
        </div>
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
        <div className="text-center p-8">
          <MapPin className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400 font-medium">
            {error || 'No route data available'}
          </p>
          {!isOnline && (
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
              Connect to the internet to load this route
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Connectivity indicator */}
      <OfflineModeIndicator showWhenOnline={false} variant="full" />

      {/* Route info header */}
      {showControls && (
        <div className="absolute top-4 right-4 z-10 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {route.metadata.tripName || 'Route'}
              </h3>
              <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">●</span>
                  <span className="truncate">{route.metadata.originName || 'Origin'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-600 dark:text-red-400">●</span>
                  <span className="truncate">{route.metadata.destinationName || 'Destination'}</span>
                </div>
              </div>
              <div className="mt-3 flex gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>{routeCacheManager.formatDistance(route.metadata.distance)}</span>
                <span>•</span>
                <span>{routeCacheManager.formatDuration(route.metadata.duration)}</span>
              </div>
            </div>
            
            {/* Action buttons */}
            {allowCaching && isOnline && (
              <div className="flex flex-col gap-2">
                {!isCached ? (
                  <button
                    onClick={handleSaveForOffline}
                    className="p-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                    title="Save for offline"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleDeleteCache}
                    className="p-2 rounded-md bg-gray-600 hover:bg-gray-700 text-white transition-colors"
                    title="Remove from offline storage"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {isCached && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                <Download className="w-3 h-3" />
                <span>Available offline</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Map display - switch between online/offline */}
      <div className="w-full h-full">
        {isOnline ? (
          <MapLibreRoute
            origin={route.metadata.origin}
            destination={route.metadata.destination}
            waypoints={route.metadata.waypoints}
            onRouteCalculated={handleRouteCalculated}
            className="w-full h-full"
          />
        ) : (
          <OfflineRouteRenderer
            geometry={route.geometry}
            origin={route.metadata.origin}
            destination={route.metadata.destination}
            className="w-full h-full"
            showGrid={false}
          />
        )}
      </div>
    </div>
  );
}
