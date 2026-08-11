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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
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

    if (
      typeof route.durationMinutes === "number" &&
      Number.isFinite(route.durationMinutes) &&
      route.durationMinutes > 0
    ) {
      const [year, month, day] = route.departureDate
        .split("-")
        .map(Number);
      const [hours, minutes] = route.departureTime
        .split(":")
        .map(Number);

      const start = new Date(
        Date.UTC(year, month - 1, day, hours, minutes, 0),
      );
      const end = new Date(
        start.getTime() + route.durationMinutes * 60_000,
      );

      lines.push(
        `DTEND:${[
          end.getUTCFullYear(),
          pad(end.getUTCMonth() + 1),
          pad(end.getUTCDate()),
          "T",
          pad(end.getUTCHours()),
          pad(end.getUTCMinutes()),
          "00",
        ].join("")}`,
      );
    }
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

  if (route.routeUrl?.trim()) {
    lines.push(`URL:${route.routeUrl.trim()}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR", "");

  return lines.join("\r\n");
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
