import {
  getUtcDateRange,
  parseDateOnlyUtc,
} from "@/lib/date-range";
import { validateIdempotencyKey } from "@/lib/idempotency";
import { normalizeDestination } from "@/lib/normalize-destination";
import { describe, expect, it } from "vitest";

describe("destination normalization", () => {
  it("normalizes case, surrounding spaces, and repeated spaces", () => {
    expect(
      normalizeDestination("  New   Delhi  "),
    ).toBe("new delhi");
  });

  it("normalizes Unicode presentation forms", () => {
    expect(normalizeDestination("Ｇｏａ")).toBe("goa");
  });
});

describe("UTC date-only handling", () => {
  it("parses a valid date without local timezone drift", () => {
    expect(
      parseDateOnlyUtc("2026-08-15").toISOString(),
    ).toBe("2026-08-15T00:00:00.000Z");
  });

  it("creates an exclusive next-day range", () => {
    const range = getUtcDateRange("2026-12-31");

    expect(range.start.toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
    expect(range.end.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("rejects impossible dates", () => {
    expect(() =>
      parseDateOnlyUtc("2026-02-30"),
    ).toThrow("Departure date is invalid.");
  });
});

describe("idempotency key validation", () => {
  it("allows a supported idempotency key", () => {
    expect(
      validateIdempotencyKey(
        "ticket-upload:browser-123",
      ),
    ).toBe("ticket-upload:browser-123");
  });

  it("allows the header to be omitted", () => {
    expect(validateIdempotencyKey(null)).toBeNull();
  });

  it("rejects short or unsafe values", () => {
    expect(() =>
      validateIdempotencyKey("short"),
    ).toThrow();
    expect(() =>
      validateIdempotencyKey(
        "contains spaces and newline\n",
      ),
    ).toThrow();
  });
});
