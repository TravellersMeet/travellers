'use client';

import React, { useState } from 'react';
import { MapLibreRoute } from '@/components/maplibre-route';
import { routeCacheManager } from '@/lib/utils/route-cache-manager';
import type { Location, RouteMetadata } from '@/lib/types/route';
import { PlaceAutocomplete } from '@/components/place-autocomplete';
import type { PlaceLocation } from '@/lib/types/places';
import { ArrowLeft, Save, MapPin } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function NewRouteClient({ userId }: { userId: string }) {
  const router = useRouter();
  
  // Form fields
  const [tripName, setTripName] = useState('');
  const [notes, setNotes] = useState('');
  
  // Location inputs
  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [originAddress, setOriginAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  
  // Location objects
  const [origin, setOrigin] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  
  // Route data
  const [routeData, setRouteData] = useState<{
    distance: number;
    duration: number;
    encodedPolyline: string;
  } | null>(null);
  
  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse location from input (lat, lng) - fallback for manual entry
  const parseLocation = (input: string): Location | null => {
    const parts = input.split(',').map((s) => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
    return null;
  };

  // Handle place selection from Google Places autocomplete
  const handleOriginPlaceSelect = (location: PlaceLocation) => {
    setOrigin({ lat: location.lat, lng: location.lng });
    setOriginInput(location.address);
    setOriginAddress(location.address);
  };

  const handleDestinationPlaceSelect = (location: PlaceLocation) => {
    setDestination({ lat: location.lat, lng: location.lng });
    setDestinationInput(location.address);
    setDestinationAddress(location.address);
  };

  // Handle manual input (for coordinate fallback)
  const handleOriginManualInput = (value: string) => {
    setOriginInput(value);
    const loc = parseLocation(value);
    if (loc) {
      setOrigin(loc);
      setOriginAddress(''); // Clear address when using coordinates
    }
  };

  const handleDestinationManualInput = (value: string) => {
    setDestinationInput(value);
    const loc = parseLocation(value);
    if (loc) {
      setDestination(loc);
      setDestinationAddress(''); // Clear address when using coordinates
    }
  };

  // Save route
  const handleSaveRoute = async () => {
    if (!origin || !destination || !routeData) {
      setError('Please set origin and destination');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const route: RouteMetadata = {
        userId,
        origin,
        destination,
        originName: originAddress || originInput,
        destinationName: destinationAddress || destinationInput,
        distance: routeData.distance,
        duration: routeData.duration,
        encodedPolyline: routeData.encodedPolyline,
        tripName:
  tripName.trim() ||
  `${originAddress || originInput} → ${destinationAddress || destinationInput}`,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      console.log("NEW ROUTE OBJECT:", route);

      // Save to server and cache
      await routeCacheManager.syncRoute(route);

      alert('Route saved successfully!');
      router.push('/routes');
    } catch (err) {
      console.error('Failed to save route:', err);
      setError('Failed to save route. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Demo route
  const useDemoRoute = () => {
    const demoOrigin = { lat: 40.7128, lng: -74.006 }; // New York
    const demoDestination = { lat: 38.9072, lng: -77.0369 }; // Washington DC

    setOrigin(demoOrigin);
    setDestination(demoDestination);
    setOriginInput('New York, NY, USA');
    setDestinationInput('Washington, DC, USA');
    setOriginAddress('New York, NY, USA');
    setDestinationAddress('Washington, DC, USA');
    setTripName('New York to Washington DC');
  };

  return (
  <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
    {/* Header */}
    <div className="border-b bg-white dark:bg-gray-800">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <Link
            href="/routes"
            className="rounded-lg border p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>

          <div>
            <h1 className="text-2xl font-bold">
              Create New Route
            </h1>

            <p className="text-sm text-gray-500">
              Plan and save your travel route.
            </p>
          </div>
        </div>
      </div>
    </div>

    <div className="mx-auto max-w-7xl p-6">

      <div className="grid gap-6 lg:grid-cols-2">

        {/* LEFT PANEL */}

        <div className="space-y-5">

          <div>
            <label className="mb-2 block font-medium">
              Trip Name
            </label>

            <input
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="Weekend Goa Trip"
              className="w-full rounded-lg border bg-white dark:bg-gray-900 p-3 text-black dark:text-white"
            />
          </div>

          <div>
            <label className="mb-2 block font-medium">
              Origin
            </label>

            <PlaceAutocomplete
              value={originInput}
              onChange={handleOriginManualInput}
              onPlaceSelect={handleOriginPlaceSelect}
            />
          </div>

          <div>
            <label className="mb-2 block font-medium">
              Destination
            </label>

            <PlaceAutocomplete
              value={destinationInput}
              onChange={handleDestinationManualInput}
              onPlaceSelect={handleDestinationPlaceSelect}
            />
          </div>

          <div>
            <label className="mb-2 block font-medium">
              Notes
            </label>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-lg border bg-white dark:bg-gray-900 p-3 text-black dark:text-white"
            />
          </div>

          {error && (
            <p className="text-red-600">
              {error}
            </p>
          )}

          <div className="flex gap-3">

  <button
    onClick={useDemoRoute}
    className="rounded-lg border px-4 py-2"
  >
    Demo Route
  </button>

  <button
    onClick={handleSaveRoute}
    disabled={isSaving}
    className="rounded-lg bg-blue-600 px-5 py-2 text-white"
  >
    {isSaving ? "Saving..." : "Save Route"}
  </button>

</div>

        </div>

                {/* RIGHT PANEL */}

        <div className="rounded-xl border bg-white dark:bg-gray-800 p-4 min-h-[650px]">

          {origin && destination ? (
            <MapLibreRoute
              origin={origin}
              destination={destination}
              onRouteCalculated={setRouteData}
              className="h-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-500">
              Select origin and destination to preview your route.
            </div>
          )}

        </div>

        {routeData && (
  <div className="mt-4 rounded-xl border bg-white dark:bg-gray-800 p-4">
    <h3 className="mb-3 text-lg font-semibold">
      Route Details
    </h3>

    <div className="space-y-2 text-sm">

      <p>
        <span className="font-medium">Distance:</span>{" "}
        {routeCacheManager.formatDistance(routeData.distance)}
      </p>

      <p>
        <span className="font-medium">Duration:</span>{" "}
        {routeCacheManager.formatDuration(routeData.duration)}
      </p>

    </div>
  </div>
)}

      </div>

    </div>
  </div>
);
}