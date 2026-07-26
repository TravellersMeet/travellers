'use client';

import React, { useState, useEffect } from 'react';
import { RouteViewer } from '@/components/route-viewer';
import { routeCacheManager } from '@/lib/utils/route-cache-manager';
import type { CachedRoute } from '@/lib/types/route';
import { Map, Plus, Search, Loader2 } from "lucide-react";
import RouteCalendarExportButton from '@/components/route-calendar-export-button';
import Link from 'next/link';
import { fetchAllPaginatedItems } from '@/lib/fetch-paginated';

export default function RoutesClient() {
  const [routes, setRoutes] = useState<CachedRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    loadRoutes();
  }, []);

  async function loadRoutes() {
    setIsLoading(true);
    try {
      const cachedRoutes = await routeCacheManager.getAllCachedRoutes();
      setRoutes(cachedRoutes);

      try {
        const serverRoutes =
          await fetchAllPaginatedItems<CachedRoute>(
            "/api/routes",
          );
        {
          for (const route of serverRoutes) {
            await routeCacheManager.cacheRoute(route);
          }
          const updatedRoutes = await routeCacheManager.getAllCachedRoutes();
          setRoutes(updatedRoutes);
        }
      } catch {
        console.log('Offline mode');
      }
    } finally {
      setIsLoading(false);
    }
  }

  const filteredRoutes = routes.filter(route => {
    const q = searchQuery.toLowerCase();
    return (
      route.tripName?.toLowerCase().includes(q) ||
      route.originName?.toLowerCase().includes(q) ||
      route.destinationName?.toLowerCase().includes(q)
    );
  });

  return (
   <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Map className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  My Routes
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  View and manage your travel routes
                </p>
              </div>
            </div>
            <Link
              href="/routes/new"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Route</span>
            </Link>
          </div>

          {/* Search */}
          <div className="mt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search routes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : filteredRoutes.length === 0 ? (
          <div className="text-center py-12">
            <Map className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              {searchQuery ? 'No routes found' : 'No routes yet'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {searchQuery
                ? 'Try a different search term'
                : 'Create your first route to get started'}
            </p>
            {!searchQuery && (
              <Link
                href="/routes/new"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
                <span>Create Route</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid lg:grid-cols-12 gap-6">
            {/* Route list */}
            <div className="lg:col-span-4 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-2">
                Saved Routes ({filteredRoutes.length})
              </h2>
              <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto">
                {filteredRoutes.map((route) => (
                  <div
                    key={route.id}
                    className={`w-full rounded-lg border p-4 transition-all ${
                      selectedRoute === route.id
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedRoute(route.id)}
                      className="w-full text-left rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                      aria-label={`View ${route.tripName || 'saved route'} on the map`}
                    >
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        {route.tripName || 'Unnamed Route'}
                      </h3>
                      <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                        <p className="truncate">
                          From: {route.originName || `${route.origin.lat.toFixed(4)}, ${route.origin.lng.toFixed(4)}`}
                        </p>
                        <p className="truncate">
                          To: {route.destinationName || `${route.destination.lat.toFixed(4)}, ${route.destination.lng.toFixed(4)}`}
                        </p>
                      </div>
                      <div className="mt-2 flex gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span>{routeCacheManager.formatDistance(route.distance)}</span>
                        <span>•</span>
                        <span>{routeCacheManager.formatDuration(route.duration)}</span>
                      </div>
                    </button>

                    <RouteCalendarExportButton
                      route={route}
                      onStatusChange={setStatusMessage}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Map viewer */}
            <div className="lg:col-span-8">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden h-[calc(100vh-250px)]">
                {selectedRoute ? (
                  <RouteViewer
                    routeId={selectedRoute}
                    allowCaching={true}
                    showControls={true}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-900">
                    <div className="text-center">
                      <Map className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600 dark:text-gray-400">
                        Select a route to view on the map
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>);
}
