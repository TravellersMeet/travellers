import { describe, expect, it } from "vitest";

import {
  createCalendarEvent,
  DEFAULT_EVENT_DURATION_MINUTES,
  addMinutesToLocalDateTime,
  escapeCalendarText,
  foldCalendarLine,
  measureOctets,
  unfoldCalendar,
} from "@/lib/calendar-export";

const MAX_LINE_OCTETS = 75;

const baseRoute = {
  id: "route-123",
  title: "Pune to Goa",
  origin: "Pune",
  destination: "Goa",
  departureDate: "2026-08-15",
};

/** Every physical line in the file, without the trailing empty one. */
function physicalLines(calendar: string): string[] {
  return calendar.split("\r\n").filter((line) => line !== "");
}

function longestLineOctets(calendar: string): number {
  return physicalLines(calendar).reduce(
    (longest, line) =>
      Math.max(longest, measureOctets(line)),
    0,
  );
}

describe("measureOctets", () => {
  it("counts ASCII as one octet per character", () => {
    expect(measureOctets("abc")).toBe(3);
  });

  it("counts multi-byte characters by their UTF-8 size", () => {
    expect(measureOctets("ó")).toBe(2);
    expect(measureOctets("東")).toBe(3);
    expect(measureOctets("😀")).toBe(4);
  });

  it("counts an empty string as zero", () => {
    expect(measureOctets("")).toBe(0);
  });
});

describe("foldCalendarLine", () => {
  it("leaves a short line untouched", () => {
    expect(foldCalendarLine("SUMMARY:Pune to Goa")).toBe(
      "SUMMARY:Pune to Goa",
    );
  });

  it("leaves a line of exactly 75 octets untouched", () => {
    const line = "X".repeat(MAX_LINE_OCTETS);

    expect(foldCalendarLine(line)).toBe(line);
  });

  it("folds a line of 76 octets", () => {
    const folded = foldCalendarLine(
      "X".repeat(MAX_LINE_OCTETS + 1),
    );

    expect(folded).toContain("\r\n ");
    expect(
      folded
        .split("\r\n")
        .every(
          (line) => measureOctets(line) <= MAX_LINE_OCTETS,
        ),
    ).toBe(true);
  });

  it("keeps every folded segment within the octet limit", () => {
    const folded = foldCalendarLine(
      `DESCRIPTION:${"a".repeat(1_000)}`,
    );

    for (const line of folded.split("\r\n")) {
      expect(measureOctets(line)).toBeLessThanOrEqual(
        MAX_LINE_OCTETS,
      );
    }
  });

  it("starts every continuation with a single space", () => {
    const folded = foldCalendarLine(
      `DESCRIPTION:${"a".repeat(300)}`,
    );
    const [, ...continuations] = folded.split("\r\n");

    expect(continuations.length).toBeGreaterThan(0);

    for (const line of continuations) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.startsWith("  ")).toBe(false);
    }
  });

  it("counts octets, not characters, for multi-byte text", () => {
    // 40 characters, 120 octets — a character-based fold would leave this
    // as a single line and still blow the limit.
    const folded = foldCalendarLine(`X:${"東".repeat(40)}`);

    expect(longestLineOctets(folded)).toBeLessThanOrEqual(
      MAX_LINE_OCTETS,
    );
  });

  it("never splits a multi-byte character across the boundary", () => {
    const folded = foldCalendarLine(`X:${"東".repeat(60)}`);

    expect(unfoldCalendar(folded)).toBe(
      `X:${"東".repeat(60)}`,
    );
    expect(folded).not.toContain("\uFFFD");
  });

  it("never splits a surrogate pair", () => {
    const original = `X:${"😀".repeat(40)}`;
    const folded = foldCalendarLine(original);

    expect(unfoldCalendar(folded)).toBe(original);
    expect(longestLineOctets(folded)).toBeLessThanOrEqual(
      MAX_LINE_OCTETS,
    );
  });

  it("round-trips through unfoldCalendar", () => {
    const original = `DESCRIPTION:${"Kraków ".repeat(40)}`;

    expect(unfoldCalendar(foldCalendarLine(original))).toBe(
      original,
    );
  });
});

describe("escapeCalendarText", () => {
  it("still escapes the reserved characters", () => {
    expect(
      escapeCalendarText(
        "Line one\nLine two, value; C:\\Trips",
      ),
    ).toBe("Line one\\nLine two\\, value\\; C:\\\\Trips");
  });

  it("strips control characters", () => {
    expect(escapeCalendarText("Meet\u0000at\u0007six")).toBe(
      "Meetatsix",
    );
  });

  it("keeps a newline as the literal escape rather than stripping it", () => {
    expect(escapeCalendarText("a\r\nb")).toBe("a\\nb");
  });

  it("leaves ordinary multi-byte text alone", () => {
    expect(escapeCalendarText("Kraków 東京")).toBe(
      "Kraków 東京",
    );
  });
});

describe("createCalendarEvent line lengths", () => {
  it("folds a long description", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      notes:
        "Overnight bus, meet at the terminal by 21:30, bring the printed reservation and a photo ID.",
    });

    expect(longestLineOctets(calendar)).toBeLessThanOrEqual(
      MAX_LINE_OCTETS,
    );
  });

  it("keeps the description readable once unfolded", () => {
    const notes =
      "Overnight bus, meet at the terminal by 21:30, bring the printed reservation and a photo ID.";
    const calendar = createCalendarEvent({
      ...baseRoute,
      notes,
    });

    expect(unfoldCalendar(calendar)).toContain(
      "Travel from Pune to Goa.\\n\\nOvernight bus\\, meet at the terminal by 21:30",
    );
  });

  it("folds a long summary", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      title:
        "Monsoon road trip from Pune to Goa with a detour through Amboli and Chorla Ghat",
    });

    expect(longestLineOctets(calendar)).toBeLessThanOrEqual(
      MAX_LINE_OCTETS,
    );
  });

  it("folds a long location", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      destination:
        "Palolem Beach, Canacona, South Goa District, Goa, India",
    });

    expect(longestLineOctets(calendar)).toBeLessThanOrEqual(
      MAX_LINE_OCTETS,
    );
  });

  it("folds a long URL", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      routeUrl: `https://travellersmeet.example/routes/${"a".repeat(120)}`,
    });

    expect(longestLineOctets(calendar)).toBeLessThanOrEqual(
      MAX_LINE_OCTETS,
    );
    expect(unfoldCalendar(calendar)).toContain(
      `URL:https://travellersmeet.example/routes/${"a".repeat(120)}`,
    );
  });

  it("folds multi-byte content correctly", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      destination: "東京",
      notes: "京都と大阪に立ち寄ります。".repeat(8),
    });

    expect(longestLineOctets(calendar)).toBeLessThanOrEqual(
      MAX_LINE_OCTETS,
    );
    expect(calendar).not.toContain("\uFFFD");
  });

  it("drops a URL containing a control character", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      routeUrl:
        "https://example.com/a\u0000SUMMARY:injected",
    });

    expect(calendar).not.toContain("injected");
    expect(calendar).not.toContain("\r\nURL:");
  });

  it("evaluates each URL independently despite the shared regex", () => {
    // CONTROL_CHARACTERS is a global regex, so a stateful `test` would make
    // the second call disagree with the first.
    const good = {
      ...baseRoute,
      routeUrl: "https://example.com/ok",
    };

    expect(createCalendarEvent(good)).toContain(
      "URL:https://example.com/ok",
    );
    expect(createCalendarEvent(good)).toContain(
      "URL:https://example.com/ok",
    );
  });

  it("keeps notes with control characters out of the file", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      notes: "Bring\u0000the\u0007tickets",
    });

    expect(unfoldCalendar(calendar)).toContain(
      "Bringthetickets",
    );
  });
});

describe("timed events", () => {
  it("uses the supplied duration", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      departureTime: "09:30",
      durationMinutes: 120,
    });

    expect(calendar).toContain("DTEND:20260815T113000");
  });

  it("falls back to a default rather than a zero-length instant", () => {
    const calendar = createCalendarEvent({
      ...baseRoute,
      departureTime: "09:30",
    });

    expect(calendar).toContain("DTSTART:20260815T093000");
    expect(calendar).toContain("DTEND:20260815T103000");
    expect(DEFAULT_EVENT_DURATION_MINUTES).toBe(60);
  });

  it("ignores a nonsensical duration", () => {
    for (const durationMinutes of [
      0,
      -30,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const calendar = createCalendarEvent({
        ...baseRoute,
        departureTime: "09:30",
        durationMinutes,
      });

      expect(calendar).toContain("DTEND:20260815T103000");
    }
  });

  it("leaves an all-day event as a DATE value", () => {
    const calendar = createCalendarEvent(baseRoute);

    expect(calendar).toContain(
      "DTSTART;VALUE=DATE:20260815",
    );
    expect(calendar).not.toContain("DTEND:");
  });
});

describe("addMinutesToLocalDateTime", () => {
  it("adds minutes within the same day", () => {
    expect(
      addMinutesToLocalDateTime("2026-08-15", "09:30", 120),
    ).toBe("20260815T113000");
  });

  it("rolls over midnight", () => {
    expect(
      addMinutesToLocalDateTime("2026-08-15", "23:30", 60),
    ).toBe("20260816T003000");
  });

  it("rolls over a month boundary", () => {
    expect(
      addMinutesToLocalDateTime("2026-08-31", "23:00", 120),
    ).toBe("20260901T010000");
  });

  it("handles a leap day", () => {
    expect(
      addMinutesToLocalDateTime("2028-02-28", "23:00", 120),
    ).toBe("20280229T010000");
  });

  it("rejects a malformed time", () => {
    expect(() =>
      addMinutesToLocalDateTime("2026-08-15", "9:30", 60),
    ).toThrow("Departure time must use HH:mm format.");
  });

  it("rejects a malformed date", () => {
    expect(() =>
      addMinutesToLocalDateTime("15-08-2026", "09:30", 60),
    ).toThrow("Departure date must use YYYY-MM-DD format.");
  });
});
