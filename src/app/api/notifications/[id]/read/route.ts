/**
 * PATCH /api/notifications/[id]/read
 *
 * Kept as an alias of PATCH /api/notifications/[id], which is the canonical
 * handler. This route was a second, independent copy of the same logic and
 * returned a different body shape (`{ success }` rather than
 * `{ ok, notification }`), so a component reading `res.ok` worked against one
 * endpoint and silently no-opped against the other.
 *
 * Re-exporting rather than deleting: the path is public API, and any client
 * still calling it should keep working.
 */
export { PATCH } from "../route";
