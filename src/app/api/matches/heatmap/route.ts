import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  aggregateDestinations,
  type DestinationBucket,
} from "@/lib/geocode-destination";
import prisma from "@/lib/prisma";

import {
  HEATMAP_MAX_FEATURES,
  HEATMAP_TICKET_LIMIT,
} from "./constants";

interface HeatmapFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    id: string;
    name: string;
    city: string;
    country: string;
    region: string;
    /** Verified upcoming tickets for this destination. */
    weight: number;
  };
}

function toFeature(bucket: DestinationBucket): HeatmapFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      // GeoJSON is [longitude, latitude], in that order.
      coordinates: [
        bucket.coordinates.lng,
        bucket.coordinates.lat,
      ],
    },
    properties: {
      id: bucket.id,
      name: bucket.name,
      city: bucket.city,
      country: bucket.country,
      region: bucket.region,
      weight: bucket.count,
    },
  };
}

/**
 * GET /api/matches/heatmap
 *
 * Returns one GeoJSON point per real destination, weighted by how many
 * verified upcoming tickets are headed there. Destinations that are not in the
 * bundled gazetteer are counted and reported rather than being placed at an
 * invented coordinate.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const tickets = await prisma.ticket.findMany({
      where: {
        status: "VERIFIED",
        departureDate: { gte: new Date() },
      },
      select: { destination: true },
      orderBy: { departureDate: "asc" },
      take: HEATMAP_TICKET_LIMIT,
    });

    const aggregate = aggregateDestinations(
      tickets.map((ticket) => ticket.destination),
    );

    const features = aggregate.buckets
      .slice(0, HEATMAP_MAX_FEATURES)
      .map(toFeature);

    const maxWeight = features.reduce(
      (highest, feature) =>
        Math.max(highest, feature.properties.weight),
      0,
    );

    return NextResponse.json({
      type: "FeatureCollection",
      features,
      // The client scales the heat ramp against maxWeight, and surfacing the
      // unresolved count keeps gazetteer gaps visible instead of silently
      // dropping traffic off the map.
      meta: {
        sampledTickets: tickets.length,
        resolvedTickets: aggregate.resolvedCount,
        unresolvedTickets:
          tickets.length - aggregate.resolvedCount,
        unresolvedDestinations: aggregate.unresolvedCount,
        totalDestinations: aggregate.buckets.length,
        maxWeight,
        truncated:
          aggregate.buckets.length > HEATMAP_MAX_FEATURES,
      },
    });
  } catch (error) {
    console.error("Heatmap API error:", error);

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
