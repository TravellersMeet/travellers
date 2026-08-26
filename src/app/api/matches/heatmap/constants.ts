/**
 * Bounds for the traveller heatmap.
 *
 * These live outside route.ts because a Next.js App Router route file may only
 * export route handlers and the framework's own config fields — any other
 * named export fails the build.
 */

/**
 * Upper bound on how many verified tickets are read for one heatmap. The
 * previous implementation had no `take` at all, so the query grew with the
 * platform. Tickets are read soonest-first, so the cap trims the far future
 * rather than the trips people are actually about to take.
 */
export const HEATMAP_TICKET_LIMIT = 5_000;

/** Hotspots returned to the client, heaviest first. */
export const HEATMAP_MAX_FEATURES = 250;
