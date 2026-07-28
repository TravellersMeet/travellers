"use client";

import { CalendarPlus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  downloadCalendarEvent,
  type CalendarRoute,
} from "@/lib/calendar-export";
import type { RouteMetadata } from "@/lib/types/route";

interface RouteCalendarExportButtonProps {
  route: RouteMetadata;
  onStatusChange?: (message: string) => void;
}

function getDefaultDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);

  return localDate.toISOString().slice(0, 10);
}

function getLocationName(
  name: string | undefined,
  coordinates: { lat: number; lng: number },
): string {
  return (
    name?.trim() ||
    `${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)}`
  );
}

export default function RouteCalendarExportButton({
  route,
  onStatusChange,
}: RouteCalendarExportButtonProps) {
  const titleId = useId();
  const descriptionId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [departureDate, setDepartureDate] = useState(
    getDefaultDate,
  );
  const [departureTime, setDepartureTime] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    firstInputRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () =>
      document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  const closeDialog = () => {
    setError("");
    setIsOpen(false);
  };

  const handleExport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    try {
      const origin = getLocationName(
        route.originName,
        route.origin,
      );
      const destination = getLocationName(
        route.destinationName,
        route.destination,
      );

      const calendarRoute: CalendarRoute = {
        id: route.id ?? crypto.randomUUID(),
        title:
          route.tripName?.trim() ||
          `${origin} to ${destination}`,
        origin,
        destination,
        departureDate,
        departureTime: departureTime || undefined,
        durationMinutes:
          route.duration > 0
            ? Math.max(1, Math.round(route.duration / 60))
            : undefined,
        notes: route.notes,
        routeUrl:
          typeof window !== "undefined"
            ? `${window.location.origin}/routes`
            : undefined,
      };

      downloadCalendarEvent(calendarRoute);
      closeDialog();
      onStatusChange?.(
        `Calendar event downloaded for ${calendarRoute.title}.`,
      );
    } catch (exportError) {
      const message =
        exportError instanceof Error
          ? exportError.message
          : "Unable to export this route.";

      setError(message);
      onStatusChange?.(message);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(true);
        }}
        className="mt-3 inline-flex items-center gap-2 rounded-md border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40 dark:focus:ring-offset-gray-800"
        aria-label={`Export ${
          route.tripName || "saved route"
        } to calendar`}
      >
        <CalendarPlus className="h-4 w-4" />
        Export to Calendar
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDialog();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={titleId}
                  className="text-xl font-semibold text-gray-900 dark:text-gray-100"
                >
                  Export route to calendar
                </h2>
                <p
                  id={descriptionId}
                  className="mt-1 text-sm text-gray-600 dark:text-gray-400"
                >
                  Choose the intended travel date. Adding a time is
                  optional.
                </p>
              </div>

              <button
                type="button"
                onClick={closeDialog}
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-gray-700"
                aria-label="Close calendar export dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              className="mt-6 space-y-5"
              onSubmit={handleExport}
            >
              <div>
                <label
                  htmlFor={`${titleId}-date`}
                  className="block text-sm font-medium text-gray-800 dark:text-gray-200"
                >
                  Travel date
                </label>
                <input
                  ref={firstInputRef}
                  id={`${titleId}-date`}
                  type="date"
                  required
                  value={departureDate}
                  onChange={(event) =>
                    setDepartureDate(event.target.value)
                  }
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>

              <div>
                <label
                  htmlFor={`${titleId}-time`}
                  className="block text-sm font-medium text-gray-800 dark:text-gray-200"
                >
                  Departure time{" "}
                  <span className="font-normal text-gray-500">
                    (optional)
                  </span>
                </label>
                <input
                  id={`${titleId}-time`}
                  type="time"
                  value={departureTime}
                  onChange={(event) =>
                    setDepartureTime(event.target.value)
                  }
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Without a time, the route is exported as an
                  all-day event.
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                >
                  <CalendarPlus className="h-4 w-4" />
                  Download .ics file
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
