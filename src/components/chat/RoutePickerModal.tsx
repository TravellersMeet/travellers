"use client";

import { useEffect, useState } from "react";
import { X, Map } from "lucide-react";
import { fetchAllPaginatedItems } from "@/lib/fetch-paginated";

interface Route {
  id: string;

  tripName: string | null;

  originName: string | null;
  destinationName: string | null;

  distance: number;
  duration: number;

  encodedPolyline: string;

  originLat: number;
  originLng: number;

  destinationLat: number;
  destinationLng: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (route: Route) => void;
}

export default function RoutePickerModal({
  open,
  onClose,
  onSelect,
}: Props) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    async function loadRoutes() {
      setLoading(true);

      try {
        const data =
          await fetchAllPaginatedItems<Route>(
            "/api/routes",
          );

        setRoutes(data);
      } catch {
        console.error("Failed to load routes");
      }

      setLoading(false);
    }

    loadRoutes();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">

      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 shadow-xl">

        <div className="flex items-center justify-between p-5 border-b">

          <h2 className="font-semibold">
            Share Route
          </h2>

          <button onClick={onClose}>
            <X className="w-5 h-5"/>
          </button>

        </div>

        <div className="max-h-96 overflow-y-auto">

          {loading ? (

            <p className="p-6 text-center">
              Loading routes...
            </p>

          ) : routes.length === 0 ? (

            <p className="p-6 text-center">
              No saved routes.
            </p>

          ) : (

            routes.map((route)=>(
              <button
                key={route.id}
                onClick={()=>{
                  onSelect(route);
                  onClose();
                }}
                className="w-full p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800 border-b"
              >

                <div className="flex items-center gap-2">

                  <Map className="w-4 h-4 text-blue-500"/>

                  <div>

                    <p className="font-medium">
                      {route.tripName || "Unnamed Route"}
                    </p>

                    <p className="text-sm text-slate-500">

                      {route.originName} → {route.destinationName}

                    </p>

                  </div>

                </div>

              </button>
            ))

          )}

        </div>

      </div>

    </div>
  );
}