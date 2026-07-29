"use client";

import { useEffect, useState } from "react";
import Map, { Source, Layer } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2 } from "lucide-react";

export default function TravelHeatmap() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHeatmap() {
      try {
        const res = await fetch("/api/matches/heatmap");
        const json = await res.json();
        if (res.ok) {
          setData(json);
        }
      } catch (error) {
        console.error("Failed to load heatmap data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchHeatmap();
  }, []);

  if (loading) {
    return (
      <div className="w-full h-[300px] rounded-2xl bg-slate-100 dark:bg-[#0A0B1E] border border-slate-200 dark:border-slate-800 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (!data || !data.features || data.features.length === 0) {
    return null; // Don't show if no data
  }

  return (
    <div className="w-full h-[300px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 relative shadow-md">
      <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-medium border border-white/10">
        🔥 Global Traveller Hotspots
      </div>
      <Map
        initialViewState={{
          longitude: 0,
          latitude: 20,
          zoom: 1.5,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        interactive={true}
        scrollZoom={false}
      >
        <Source type="geojson" data={data}>
          <Layer
            id="heatmap-layer"
            type="heatmap"
            paint={{
              // Increase weight as zoom increases
              "heatmap-weight": 1,
              // Increase the heatmap color weight weight by zoom level
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0, 1,
                9, 3
              ],
              // Color ramp from transparent to blue to red
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0, "rgba(33,102,172,0)",
                0.2, "rgb(103,169,207)",
                0.4, "rgb(209,229,240)",
                0.6, "rgb(253,219,199)",
                0.8, "rgb(239,138,98)",
                1, "rgb(178,24,43)"
              ],
              // Adjust the heatmap radius by zoom level
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0, 15,
                9, 30
              ],
              // Transition from heatmap to circle layer by zoom level
              "heatmap-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                7, 1,
                9, 0
              ],
            }}
          />
        </Source>
      </Map>
    </div>
  );
}
