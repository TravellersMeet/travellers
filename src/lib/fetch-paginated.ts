interface PaginationMetadata {
  nextCursor: string | null;
  hasMore: boolean;
}

interface PaginatedPayload<T> {
  items: T[];
  pagination: PaginationMetadata;
}

export async function fetchAllPaginatedItems<T>(
  url: string,
  pageLimit = 100,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;

  do {
    const target = new URL(url, window.location.origin);
    target.searchParams.set(
      "limit",
      String(pageLimit),
    );

    if (cursor) {
      target.searchParams.set("cursor", cursor);
    }

    const response = await fetch(
      `${target.pathname}${target.search}`,
    );

    if (!response.ok) {
      throw new Error(
        `Request failed with status ${response.status}`,
      );
    }

    const payload =
      (await response.json()) as PaginatedPayload<T>;

    items.push(...payload.items);
    cursor = payload.pagination.hasMore
      ? payload.pagination.nextCursor
      : null;
  } while (cursor);

  return items;
}
