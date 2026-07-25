'use client';

import type { PlaceLocation } from '@/lib/types/places';
import { useState } from "react";

interface Props {
  id?: string;
  label?: string;
  value: string;
  placeholder?: string;
  required?: boolean;

  onChange: (value: string) => void;
  onPlaceSelect: (place: PlaceLocation) => void;
}

export function PlaceAutocomplete({
  id,
  label,
  value,
  placeholder,
  required,
  onChange,
  onPlaceSelect,
}: Props) {
  const [loading, setLoading] = useState(false);
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium">
          {label}
        </label>
      )}

      <input
        id={id}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={async (e) => {
  const text = e.target.value;

  onChange(text);

  // keep the old coordinate support
  const parts = text.split(",");

  if (parts.length === 2) {
    const lat = Number(parts[0].trim());
    const lng = Number(parts[1].trim());

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      onPlaceSelect({
        address: text,
        lat,
        lng,
        placeId: "",
      });

      return;
    }
  }

  // Don't search until user types at least 3 chars
  if (text.length < 3) return;

  try {
    setLoading(true);

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_NOMINATIM_URL}/search?format=json&q=${encodeURIComponent(
        text
      )}&limit=1`
    );

    const results = await response.json();

    if (results.length > 0) {
      onPlaceSelect({
        address: results[0].display_name,
        lat: Number(results[0].lat),
        lng: Number(results[0].lon),
        placeId: String(results[0].place_id),
      });
    }
  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
}}
        className="w-full rounded-lg border border-gray-300 bg-white dark:bg-gray-900 px-4 py-2 text-black dark:text-white placeholder:text-gray-400"
      />

      <p className="text-xs text-gray-500">
        Enter coordinates like:
        <br />
        20.2961, 85.8245
      </p>
    </div>
  );
}