export interface CalendarRoute {
  id: string;
  title: string;
  origin?: string;
  destination: string;
  departureDate: string;
  departureTime?: string;
  durationMinutes?: number;
  notes?: string;
  routeUrl?: string;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/** RFC 5545 3.1: a content line must not exceed 75 octets, excluding CRLF. */
const MAX_LINE_OCTETS = 75;

/**
 * Control characters are not valid inside an iCalendar TEXT value. CR and LF
 * are handled separately by `escapeCalendarText`, which turns them into the
 * literal `\n` escape before this strips what is left.
 */
const CONTROL_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * How long a timed event runs when the caller gives no duration. RFC 5545
 * treats a DATE-TIME DTSTART with no DTEND as a zero-length instant, which
 * Google Calendar renders as an easily missed 0-minute entry.
 */
export const DEFAULT_EVENT_DURATION_MINUTES = 60;

/**
 * UTF-8 length of a single code point.
 *
 * Deliberately computed rather than measured with `Buffer.byteLength`:
 * `downloadCalendarEvent` runs in the browser, where `Buffer` does not exist.
 */
function octetLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }

  if (codePoint <= 0x07ff) {
    return 2;
  }

  if (codePoint <= 0xffff) {
    return 3;
  }

  return 4;
}

export function measureOctets(value: string): number {
  let total = 0;

  for (const character of value) {
    total += octetLength(character.codePointAt(0) ?? 0);
  }

  return total;
}

/**
 * Folds one content line to the 75-octet limit, continuing with CRLF plus a
 * single space.
 *
 * Iteration is over code points, not UTF-16 units, so a surrogate pair is
 * never split across the boundary — and the budget is measured in octets,
 * because destinations like "Kraków" and "東京" cost more than one byte per
 * character and a character-based fold would still overflow.
 */
export function foldCalendarLine(line: string): string {
  if (measureOctets(line) <= MAX_LINE_OCTETS) {
    return line;
  }

  const segments: string[] = [];
  let current = "";
  let currentOctets = 0;
  let budget = MAX_LINE_OCTETS;

  for (const character of line) {
    const size = octetLength(character.codePointAt(0) ?? 0);

    if (currentOctets + size > budget) {
      segments.push(current);
      current = "";
      currentOctets = 0;
      // The leading space on a continuation line counts toward the limit.
      budget = MAX_LINE_OCTETS - 1;
    }

    current += character;
    currentOctets += size;
  }

  if (current) {
    segments.push(current);
  }

  return segments.join("\r\n ");
}

/**
 * Reverses folding. Used by the tests to assert on logical property lines,
 * and useful to anyone parsing a file this module produced.
 */
export function unfoldCalendar(content: string): string {
  return content.replace(/\r\n[ \t]/g, "");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function formatUtcTimestamp(date: Date): string {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

export function formatCalendarDate(date: string): string {
  if (!DATE_ONLY_PATTERN.test(date)) {
    throw new Error("Departure date must use YYYY-MM-DD format.");
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Departure date is invalid.");
  }

  return `${year}${pad(month)}${pad(day)}`;
}

export function formatLocalDateTime(
  date: string,
  time: string,
): string {
  const formattedDate = formatCalendarDate(date);

  if (!TIME_PATTERN.test(time)) {
    throw new Error("Departure time must use HH:mm format.");
  }

  const [hours, minutes] = time.split(":").map(Number);

  if (hours > 23 || minutes > 59) {
    throw new Error("Departure time is invalid.");
  }

  return `${formattedDate}T${pad(hours)}${pad(minutes)}00`;
}

/**
 * Advances a floating local DATE-TIME by a number of minutes.
 *
 * The arithmetic runs through `Date.UTC` purely to get correct calendar
 * rollover (month ends, leap years). The result is formatted back as a
 * floating local time to match DTSTART, so no timezone is introduced.
 */
export function addMinutesToLocalDateTime(
  date: string,
  time: string,
  minutes: number,
): string {
  // Validates both inputs and throws on anything malformed.
  formatLocalDateTime(date, time);

  const [year, month, day] = date.split("-").map(Number);
  const [hours, mins] = time.split(":").map(Number);

  const shifted = new Date(
    Date.UTC(year, month - 1, day, hours, mins, 0) +
      minutes * 60_000,
  );

  return [
    shifted.getUTCFullYear(),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
    "T",
    pad(shifted.getUTCHours()),
    pad(shifted.getUTCMinutes()),
    "00",
  ].join("");
}

export function createStableEventUid(routeId: string): string {
  const normalizedId = routeId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${normalizedId || "saved-route"}@travellersmeet`;
}

export function createSafeCalendarFileName(title: string): string {
  const normalizedTitle = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();

  return `${normalizedTitle || "saved-route"}.ics`;
}

function buildDescription(route: CalendarRoute): string {
  const parts = [
    route.origin
      ? `Travel from ${route.origin} to ${route.destination}.`
      : `Travel to ${route.destination}.`,
    route.notes?.trim(),
  ].filter(Boolean);

  return parts.join("\n\n");
}

export function createCalendarEvent(
  route: CalendarRoute,
  now = new Date(),
): string {
  const title = route.title.trim() || "Saved travel route";
  const destination = route.destination.trim();

  if (!destination) {
    throw new Error("Destination is required.");
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TravellersMeet//Saved Route//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${createStableEventUid(route.id)}`,
    `DTSTAMP:${formatUtcTimestamp(now)}`,
  ];

  if (route.departureTime) {
    lines.push(
      `DTSTART:${formatLocalDateTime(
        route.departureDate,
        route.departureTime,
      )}`,
    );

    // A DATE-TIME DTSTART with no DTEND is a zero-length instant per RFC 5545
    // 3.6.1, so fall back to a default rather than emitting nothing.
    const durationMinutes =
      typeof route.durationMinutes === "number" &&
      Number.isFinite(route.durationMinutes) &&
      route.durationMinutes > 0
        ? route.durationMinutes
        : DEFAULT_EVENT_DURATION_MINUTES;

    lines.push(
      `DTEND:${addMinutesToLocalDateTime(
        route.departureDate,
        route.departureTime,
        durationMinutes,
      )}`,
    );
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${formatCalendarDate(
        route.departureDate,
      )}`,
    );
  }

  lines.push(
    `SUMMARY:${escapeCalendarText(title)}`,
    `DESCRIPTION:${escapeCalendarText(buildDescription(route))}`,
    `LOCATION:${escapeCalendarText(destination)}`,
  );

  const routeUrl = route.routeUrl?.trim();

  // A newline inside the value would terminate the property and let the rest
  // of the string be read as a new one, so anything with a control character
  // is dropped rather than sanitised into something that looks valid.
  if (routeUrl && !CONTROL_CHARACTERS.test(routeUrl)) {
    lines.push(`URL:${routeUrl}`);
  }

  // Reset lastIndex: CONTROL_CHARACTERS is a global regex, and `test` on a
  // global regex is stateful.
  CONTROL_CHARACTERS.lastIndex = 0;

  lines.push("END:VEVENT", "END:VCALENDAR", "");

  // Folding is applied here, once, so no call site has to remember it.
  return lines.map(foldCalendarLine).join("\r\n");
}

export function downloadCalendarEvent(
  route: CalendarRoute,
): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined"
  ) {
    throw new Error(
      "Calendar downloads are only available in the browser.",
    );
  }

  const content = createCalendarEvent(route);
  const blob = new Blob([content], {
    type: "text/calendar;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  try {
    anchor.href = objectUrl;
    anchor.download = createSafeCalendarFileName(route.title);
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
