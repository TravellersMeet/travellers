"use client";

import { MapPin, Navigation, Clock, Flag, Route, } from "lucide-react";
import { RouteViewer } from "@/components/route-viewer";

interface RouteShareCardProps {
  route: {
    id: string;
    tripName: string | null;

    originName: string | null;
    destinationName: string | null;

    originLat: number;
    originLng: number;

    destinationLat: number;
    destinationLng: number;

    distance: number;
    duration: number;

    encodedPolyline: string;
  }
}

export default function RouteShareCard({
  route,
}: RouteShareCardProps) {
  const distanceKm = (route.distance / 1000).toFixed(1);

  const durationMinutes = Math.round(route.duration / 60);

  const hours = Math.floor(durationMinutes / 60);

  const mins = durationMinutes % 60;

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 shadow-sm transition-all hover:border-blue-300 hover:shadow-md dark:border-blue-800 dark:bg-slate-900">

      <div className="p-5">

        <div className="mb-4 flex items-center gap-2">

  <Navigation className="h-5 w-5 text-blue-600" />

  <h4 className="text-base font-semibold text-slate-900 dark:text-white">
            {route.tripName || "Shared Route"}
          </h4>

        </div>

        <div className="space-y-2 text-xs">

          <div className="flex items-start gap-3">

  <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />

  <div>

    <p className="text-[11px] uppercase tracking-wide text-slate-500">
      Origin
    </p>

    <p className="text-sm text-slate-900 dark:text-white">
      {route.originName ??
        `${route.originLat.toFixed(4)}, ${route.originLng.toFixed(4)}`}
    </p>

  </div>

</div>

<div className="ml-2 h-4 w-px bg-slate-300 dark:bg-slate-700" />

<div className="flex items-start gap-3">

  <Flag className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />

  <div>

    <p className="text-[11px] uppercase tracking-wide text-slate-500">
      Destination
    </p>

    <p className="text-sm text-slate-900 dark:text-white">
      {route.destinationName ??
        `${route.destinationLat.toFixed(4)}, ${route.destinationLng.toFixed(4)}`}
    </p>

  </div>

</div>

          <div className="mt-4 flex flex-wrap gap-2">

  <div className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
    <Route className="h-3 w-3" />
    {distanceKm} km
  </div>

  <div className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
    <Clock className="h-3 w-3" />
    {hours > 0 ? `${hours}h ${mins}m` : `${mins} min`}
  </div>

</div>

        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 shadow-sm dark:border-slate-700">
  <RouteViewer
    routeId={route.id}
    allowCaching
    showControls
  />
</div>

      </div>

    </div>
  );
}