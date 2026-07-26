export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface PaginationCursor {
  timestamp: string;
  id: string;
}

export interface PaginationMetadata {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

export class PaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginationError";
  }
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encodeCursor(
  cursor: PaginationCursor,
): string {
  return toBase64Url(
    JSON.stringify({
      version: 1,
      timestamp: cursor.timestamp,
      id: cursor.id,
    }),
  );
}

export function decodeCursor(
  value: string,
): PaginationCursor {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as {
      version?: unknown;
      timestamp?: unknown;
      id?: unknown;
    };

    if (
      parsed.version !== 1 ||
      typeof parsed.timestamp !== "string" ||
      typeof parsed.id !== "string" ||
      !parsed.id.trim()
    ) {
      throw new PaginationError("Cursor is invalid");
    }

    const date = new Date(parsed.timestamp);

    if (Number.isNaN(date.getTime())) {
      throw new PaginationError("Cursor is invalid");
    }

    return {
      timestamp: date.toISOString(),
      id: parsed.id,
    };
  } catch (error) {
    if (error instanceof PaginationError) {
      throw error;
    }

    throw new PaginationError("Cursor is invalid");
  }
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
): {
  limit: number;
  cursor: PaginationCursor | null;
} {
  const rawLimit = searchParams.get("limit");
  let limit = DEFAULT_PAGE_LIMIT;

  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      throw new PaginationError(
        "Limit must be a positive integer",
      );
    }

    const parsed = Number(rawLimit);

    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new PaginationError(
        "Limit must be a positive integer",
      );
    }

    limit = Math.min(parsed, MAX_PAGE_LIMIT);
  }

  const rawCursor = searchParams.get("cursor");

  return {
    limit,
    cursor: rawCursor ? decodeCursor(rawCursor) : null,
  };
}

export function buildTimestampCursorWhere(
  field: "createdAt" | "updatedAt",
  cursor: PaginationCursor | null,
):
  | {
      OR: Array<Record<string, unknown>>;
    }
  | undefined {
  if (!cursor) {
    return undefined;
  }

  const timestamp = new Date(cursor.timestamp);

  return {
    OR: [
      {
        [field]: {
          lt: timestamp,
        },
      },
      {
        [field]: timestamp,
        id: {
          lt: cursor.id,
        },
      },
    ],
  };
}

export function createPaginatedResponse<
  T extends {
    id: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  },
>(
  records: T[],
  limit: number,
  timestampField: "createdAt" | "updatedAt",
): PaginatedResponse<T> {
  const hasMore = records.length > limit;
  const items = hasMore
    ? records.slice(0, limit)
    : records;

  const lastItem = items.at(-1);
  const timestampValue = lastItem?.[timestampField];

  const nextCursor =
    hasMore && lastItem && timestampValue
      ? encodeCursor({
          id: lastItem.id,
          timestamp: new Date(timestampValue).toISOString(),
        })
      : null;

  return {
    items,
    pagination: {
      limit,
      nextCursor,
      hasMore,
    },
  };
}
