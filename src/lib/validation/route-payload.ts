import { z } from "zod";

/**
 * Bounds for a saved route payload.
 *
 * The columns behind these fields are unconstrained (`Float` for coordinates,
 * `@db.Text` for the polyline and notes), so the request schema is the only
 * place a nonsensical or oversized route can be stopped.
 */
export const ROUTE_LIMITS = {
  /** OSRM polylines for a cross-continent drive sit well under this. */
  encodedPolylineMax: 200_000,
  waypoints: 25,
  waypointNameMax: 200,
  placeNameMax: 200,
  tripNameMax: 120,
  notesMax: 2_000,
  /** Metres. Roughly the equatorial circumference, so any real trip fits. */
  distanceMax: 40_075_000,
  /** Seconds. One year — a ceiling, not a plausible journey. */
  durationMax: 31_536_000,
  /** Saved routes per user, to keep the table from growing without bound. */
  routesPerUser: 200,
} as const;

/**
 * A finite, non-negative measurement.
 *
 * `z.number()` accepts `NaN` and `Infinity`, and both reached Prisma before
 * this: `NaN` was written and then serialised back out as `null`, so a route
 * read differently from how it was written.
 */
function measurement(max: number, unit: string) {
  return z
    .number()
    .finite(`Must be a finite number of ${unit}`)
    .min(0, `Cannot be negative`)
    .max(max, `Must be at most ${max} ${unit}`);
}

export const latitudeSchema = z
  .number()
  .finite("Latitude must be a finite number")
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

export const longitudeSchema = z
  .number()
  .finite("Longitude must be a finite number")
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

export const coordinateSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});

export type Coordinate = z.infer<typeof coordinateSchema>;

/**
 * `stopover` defaults to `true` rather than being required: the map client
 * omits it for waypoints dragged onto the line, and rejecting those produced a
 * confusing "Invalid input" for a payload that was otherwise fine.
 */
export const waypointSchema = z.object({
  location: coordinateSchema,
  stopover: z.boolean().default(true),
  name: z
    .string()
    .max(
      ROUTE_LIMITS.waypointNameMax,
      `Waypoint name must be ${ROUTE_LIMITS.waypointNameMax} characters or fewer`,
    )
    .optional(),
});

function boundedName(max: number, label: string) {
  return z
    .string()
    .max(max, `${label} must be ${max} characters or fewer`)
    .optional();
}

export const routePayloadSchema = z.object({
  id: z.string().min(1).optional(),
  origin: coordinateSchema,
  destination: coordinateSchema,
  waypoints: z
    .array(waypointSchema)
    .max(
      ROUTE_LIMITS.waypoints,
      `A route can have at most ${ROUTE_LIMITS.waypoints} waypoints`,
    )
    .optional(),
  originName: boundedName(
    ROUTE_LIMITS.placeNameMax,
    "Origin name",
  ),
  destinationName: boundedName(
    ROUTE_LIMITS.placeNameMax,
    "Destination name",
  ),
  distance: measurement(ROUTE_LIMITS.distanceMax, "metres"),
  duration: measurement(ROUTE_LIMITS.durationMax, "seconds"),
  encodedPolyline: z
    .string()
    .min(1, "Encoded polyline required")
    .max(
      ROUTE_LIMITS.encodedPolylineMax,
      "Encoded polyline is too large",
    ),
  tripName: boundedName(
    ROUTE_LIMITS.tripNameMax,
    "Trip name",
  ),
  notes: boundedName(ROUTE_LIMITS.notesMax, "Notes"),
});

export type RoutePayload = z.infer<typeof routePayloadSchema>;
