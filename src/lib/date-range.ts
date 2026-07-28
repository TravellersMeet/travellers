const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface UtcDateRange {
  start: Date;
  end: Date;
}

export function parseDateOnlyUtc(value: string): Date {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error("Departure date must use YYYY-MM-DD format.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Departure date is invalid.");
  }

  return parsed;
}

export function getUtcDateRange(value: string): UtcDateRange {
  const start = parseDateOnlyUtc(value);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}
