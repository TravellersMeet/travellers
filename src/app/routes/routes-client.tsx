'use client';

import React, { useState, useEffect } from 'react';
import { RouteViewer } from '@/components/route-viewer';
import { routeCacheManager } from '@/lib/utils/route-cache-manager';
import type { CachedRoute } from '@/lib/types/route';
import {
  Map,
  Plus,
  Search,
  Loader2,
  Trash2,
  Pencil,
} from "lucide-react";
import RouteCalendarExportButton from '@/components/route-calendar-export-button';
import Link from 'next/link';
import { fetchAllPaginatedItems } from '@/lib/fetch-paginated';

export default function RoutesClient() {
  const [routes, setRoutes] = useState<CachedRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [editingRoute, setEditingRoute] = useState<CachedRoute | null>(null);
  const [editTripName, setEditTripName] = useState("");
  const [editNotes, setEditNotes] = useState("");

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

  const handleDeleteRoute = async (routeId: string) => {
  const confirmed = window.confirm(
    "Are you sure you want to delete this route?"
  );

  if (!confirmed) return;

  try {
    const response = await fetch(`/api/routes?id=${routeId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete route");
    }

    // Remove from IndexedDB cache
    await routeCacheManager.deleteCachedRoute(routeId);

    // Remove from UI
    setRoutes((prev) => prev.filter((route) => route.id !== routeId));

    // If deleted route is selected, clear viewer
    if (selectedRoute === routeId) {
      setSelectedRoute(null);
    }

    setStatusMessage("Route deleted successfully.");
  } catch (err) {
    console.error(err);
    alert("Failed to delete route.");
  }
};

const handleSaveEdit = async () => {
  if (!editingRoute) return;

  try {
    const response = await fetch("/api/routes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
  id: editingRoute.id,

  origin: editingRoute.origin,
  destination: editingRoute.destination,

  waypoints:
  typeof editingRoute.waypoints === "string"
    ? JSON.parse(editingRoute.waypoints)
    : editingRoute.waypoints || [],

  originName: editingRoute.originName,
  destinationName: editingRoute.destinationName,

  distance: editingRoute.distance,
  duration: editingRoute.duration,
  encodedPolyline: editingRoute.encodedPolyline,

  tripName: editTripName,
  notes: editNotes,
}),
    });

    if (!response.ok) {
  const error = await response.json();
  console.log("FIELD ERRORS:", error.details.fieldErrors);
  alert(JSON.stringify(error, null, 2));
  return;
}

    const updatedRoute = await response.json();

    // Update IndexedDB
    await routeCacheManager.cacheRoute(updatedRoute);

    // Update UI immediately
    setRoutes((prev) =>
  prev.map((route) =>
    route.id === updatedRoute.id
      ? {
          ...route,
          ...updatedRoute,
        }
      : route
  )
);

    setEditingRoute(null);
    setStatusMessage("Route updated successfully.");
  } catch (err) {
    console.error(err);
    alert("Failed to update route.");
  }
};

  const filteredRoutes = routes.filter(route => {
    const q = searchQuery.toLowerCase();
    return (
      route.tripName?.toLowerCase().includes(q) ||
      route.originName?.toLowerCase().includes(q) ||
      route.destinationName?.toLowerCase().includes(q)
    );
  });

  return (
    <>
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
                      onClick={() => setSelectedRoute(route.id ?? null)}
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

                    <div className="mt-4 flex items-center justify-between">
  <RouteCalendarExportButton
    route={route}
    onStatusChange={setStatusMessage}
  />

<div className="flex items-center gap-2">
  <button
  onClick={() => {
  console.log("ROUTE OBJECT:", route);

  setEditingRoute(route);
  setEditTripName(route.tripName || "");
  setEditNotes(route.notes || "");
}}
  className="rounded-md p-2 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition"
  title="Edit Route"
>
  <Pencil className="w-4 h-4" />
</button>

  <button
    onClick={() => {
  if (route.id) {
    handleDeleteRoute(route.id);
  }
}}
    className="rounded-md p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 transition"
    title="Delete Route"
  >
    <Trash2 className="w-4 h-4" />
  </button>
</div>
</div>
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
    </div>

{editingRoute && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-6 shadow-xl">

      <h2 className="text-xl font-semibold mb-4">
        Edit Route
      </h2>

      <div className="space-y-4">

        <div>
          <label className="block mb-1 font-medium">
            Trip Name
          </label>

          <input
            value={editTripName}
            onChange={(e) => setEditTripName(e.target.value)}
            className="w-full rounded-lg border p-2 dark:bg-gray-900"
          />
        </div>

        <div>
          <label className="block mb-1 font-medium">
            Notes
          </label>

          <textarea
            rows={4}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            className="w-full rounded-lg border p-2 dark:bg-gray-900"
          />
        </div>

      </div>

      <div className="mt-6 flex justify-end gap-3">

        <button
          onClick={() => setEditingRoute(null)}
          className="rounded-lg border px-4 py-2"
        >
          Cancel
        </button>

        <button
           onClick={handleSaveEdit}
  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Save Changes
        </button>

      </div>

    </div>
  </div>
)}
</>
);
}
