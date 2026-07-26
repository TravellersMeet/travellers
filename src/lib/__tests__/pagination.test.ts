import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_LIMIT,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import { describe, expect, it } from "vitest";

describe("pagination parameters", () => {
  it("uses the default limit", () => {
    expect(
      parsePaginationParams(new URLSearchParams()),
    ).toEqual({
      limit: 20,
      cursor: null,
    });
  });

  it("accepts a valid limit and cursor", () => {
    const cursor = encodeCursor({
      id: "route-2",
      timestamp: "2026-07-22T12:00:00.000Z",
    });

    expect(
      parsePaginationParams(
        new URLSearchParams({
          limit: "25",
          cursor,
        }),
      ),
    ).toEqual({
      limit: 25,
      cursor: {
        id: "route-2",
        timestamp: "2026-07-22T12:00:00.000Z",
      },
    });
  });

  it("caps limits at the maximum", () => {
    expect(
      parsePaginationParams(
        new URLSearchParams({
          limit: "999",
        }),
      ).limit,
    ).toBe(MAX_PAGE_LIMIT);
  });

  it.each(["0", "-1", "abc", "1.5"])(
    "rejects invalid limit %s",
    (limit) => {
      expect(() =>
        parsePaginationParams(
          new URLSearchParams({ limit }),
        ),
      ).toThrow(PaginationError);
    },
  );

  it("rejects malformed cursors", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(
      PaginationError,
    );
  });
});

describe("deletion-safe timestamp cursors", () => {
  it("builds a keyset predicate without looking up the cursor row", () => {
    expect(
      buildTimestampCursorWhere("createdAt", {
        id: "ticket-10",
        timestamp: "2026-07-22T12:00:00.000Z",
      }),
    ).toEqual({
      OR: [
        {
          createdAt: {
            lt: new Date(
              "2026-07-22T12:00:00.000Z",
            ),
          },
        },
        {
          createdAt: new Date(
            "2026-07-22T12:00:00.000Z",
          ),
          id: {
            lt: "ticket-10",
          },
        },
      ],
    });
  });
});

describe("paginated responses", () => {
  const records = [
    {
      id: "3",
      createdAt: new Date(
        "2026-07-22T12:00:00.000Z",
      ),
    },
    {
      id: "2",
      createdAt: new Date(
        "2026-07-22T11:00:00.000Z",
      ),
    },
    {
      id: "1",
      createdAt: new Date(
        "2026-07-22T10:00:00.000Z",
      ),
    },
  ];

  it("returns a first page with a next cursor", () => {
    const result = createPaginatedResponse(
      records,
      2,
      "createdAt",
    );

    expect(result.items.map((item) => item.id)).toEqual([
      "3",
      "2",
    ]);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextCursor).not.toBeNull();
  });

  it("returns a final page without a next cursor", () => {
    const result = createPaginatedResponse(
      records.slice(0, 2),
      2,
      "createdAt",
    );

    expect(result.pagination).toEqual({
      limit: 2,
      hasMore: false,
      nextCursor: null,
    });
  });
});
