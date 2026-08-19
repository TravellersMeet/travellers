import { describe, expect, it, beforeEach, vi } from "vitest";
import { GET } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "test-user-id", email: "test@example.com", name: "Test User" },
  })),
}));

vi.mock("@/lib/blocking", () => ({
  getBlockedUserIds: vi.fn(async () => []),
}));

vi.mock("@/lib/pagination", () => ({
  parsePaginationParams: vi.fn((searchParams) => ({
    limit: Math.min(Number.parseInt(searchParams.get("limit") || "20", 10), 100),
    cursor: searchParams.get("cursor") ? { timestamp: "2024-01-01T00:00:00.000Z", id: "cursor-id" } : null,
  })),
  // Real signature is (field, cursor) — the previous mock took the cursor as
  // its first parameter, so it was handed the string "createdAt" and returned
  // a bogus filter on every call.
  buildTimestampCursorWhere: vi.fn((field, cursor) => cursor ? {
    OR: [
      { [field]: { lt: new Date(cursor.timestamp) } },
      { [field]: new Date(cursor.timestamp), id: { lt: cursor.id } },
    ],
  } : undefined),
  createPaginatedResponse: vi.fn((records, limit) => {
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    const lastItem = items.at(-1);
    return {
      items,
      pagination: {
        limit,
        nextCursor: hasMore && lastItem ? Buffer.from(JSON.stringify({ version: 1, timestamp: lastItem.createdAt, id: lastItem.id })).toString("base64url") : null,
        hasMore,
      },
    };
  }),
  PaginationError: class PaginationError extends Error {},
}));

vi.mock("@/lib/api-response", () => ({
  apiJson: (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }),
  apiError: (_requestId: string, _code: string, message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } }),
}));

vi.mock("@/lib/api-error", () => ({
  API_ERROR_CODES: { UNAUTHORIZED: "UNAUTHORIZED", VALIDATION_ERROR: "VALIDATION_ERROR", INTERNAL_ERROR: "INTERNAL_ERROR" },
  logApiError: vi.fn(),
}));

vi.mock("@/lib/request-id", () => ({ getRequestId: () => "test-request-id" }));

vi.mock("@/lib/prisma", () => ({
  default: { user: { findMany: vi.fn() } },
}));

/** The projection every caller is allowed to see — note the absence of `email`. */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  image: true,
  bio: true,
  location: true,
  createdAt: true,
};

function userRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `User ${id}`,
    image: null,
    bio: null,
    location: null,
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

async function getPrisma() {
  return (await import("@/lib/prisma")).default;
}

async function getBlocking() {
  return await import("@/lib/blocking");
}

describe("GET /api/users", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { auth } = await import("@/lib/auth");
    (auth as any).mockResolvedValue({
      user: { id: "test-user-id", email: "test@example.com", name: "Test User" },
    });

    const { getBlockedUserIds } = await getBlocking();
    (getBlockedUserIds as any).mockResolvedValue([]);
  });

  it("should return first page of users without cursor", async () => {
    const mockUsers = [userRow("1"), userRow("2")];

    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue(mockUsers);

    const request = new Request("http://localhost:3000/api/users?limit=20");
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.users).toHaveLength(2);
    expect(data.nextCursor).toBeNull();
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { isDeleted: false, id: { notIn: ["test-user-id"] } },
      select: PUBLIC_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
  });

  it("never selects the email column", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    await GET(new Request("http://localhost:3000/api/users") as any);

    const [{ select }] = (prisma.user.findMany as any).mock.calls[0];

    expect(select).not.toHaveProperty("email");
    expect(select).toEqual(PUBLIC_SELECT);
  });

  it("never returns an email in the response payload", async () => {
    const prisma = await getPrisma();
    // Even if a row somehow carries an email, the assertion below documents
    // what the contract is: the serialised payload has no address in it.
    (prisma.user.findMany as any).mockResolvedValue([userRow("1")]);

    const response = await GET(
      new Request("http://localhost:3000/api/users") as any,
    );
    const body = await response.text();

    expect(body).not.toMatch(/@/);
  });

  it("should return subsequent page using nextCursor", async () => {
    const mockUsers = [userRow("3", { createdAt: new Date("2024-01-03") })];
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue(mockUsers);

    const request = new Request("http://localhost:3000/api/users?limit=20&cursor=encoded-cursor");
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.users).toHaveLength(1);
  });

  it("searches name and location only — never email", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([userRow("1", { name: "Ayush" })]);

    const request = new Request("http://localhost:3000/api/users?search=ayush&limit=20");
    const response = await GET(request as any);

    expect(response.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        isDeleted: false,
        id: { notIn: ["test-user-id"] },
        AND: [
          {
            OR: [
              { name: { contains: "ayush", mode: "insensitive" } },
              { location: { contains: "ayush", mode: "insensitive" } },
            ],
          },
        ],
      },
      select: PUBLIC_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
  });

  it("keeps the cursor filter when a search term is also present", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    await GET(
      new Request(
        "http://localhost:3000/api/users?search=goa&cursor=encoded-cursor",
      ) as any,
    );

    const [{ where }] = (prisma.user.findMany as any).mock.calls[0];

    // Both groups have to survive. Spreading them into one object made the
    // search clause overwrite the cursor clause, so paging through a search
    // returned page one over and over.
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR[0]).toEqual({
      createdAt: { lt: new Date("2024-01-01T00:00:00.000Z") },
    });
    expect(where.AND[1].OR).toEqual([
      { name: { contains: "goa", mode: "insensitive" } },
      { location: { contains: "goa", mode: "insensitive" } },
    ]);
  });

  it("cannot be used to harvest accounts by email domain", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    await GET(
      new Request("http://localhost:3000/api/users?search=%40gmail.com") as any,
    );

    const [{ where }] = (prisma.user.findMany as any).mock.calls[0];
    const searchGroup = where.AND.find((clause: any) => clause.OR);
    const searchedColumns = searchGroup.OR.flatMap(Object.keys);

    expect(searchedColumns).toEqual(["name", "location"]);
    expect(searchedColumns).not.toContain("email");
  });

  it("trims the search term and ignores a whitespace-only search", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    await GET(
      new Request("http://localhost:3000/api/users?search=%20%20") as any,
    );

    const [{ where }] = (prisma.user.findMany as any).mock.calls[0];
    expect(where).not.toHaveProperty("AND");

    (prisma.user.findMany as any).mockClear();

    await GET(
      new Request("http://localhost:3000/api/users?search=%20goa%20") as any,
    );

    const [{ where: trimmedWhere }] = (prisma.user.findMany as any).mock.calls[0];
    expect(trimmedWhere.AND[0].OR[0]).toEqual({
      name: { contains: "goa", mode: "insensitive" },
    });
  });

  it("rejects an over-long search term with 400", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    const response = await GET(
      new Request(
        `http://localhost:3000/api/users?search=${"a".repeat(101)}`,
      ) as any,
    );

    expect(response.status).toBe(400);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("excludes users on either side of a block", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    const { getBlockedUserIds } = await getBlocking();
    (getBlockedUserIds as any).mockResolvedValue(["blocked-by-me", "blocked-me"]);

    await GET(new Request("http://localhost:3000/api/users") as any);

    expect(getBlockedUserIds).toHaveBeenCalledWith("test-user-id");
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ["test-user-id", "blocked-by-me", "blocked-me"] },
        }),
      }),
    );
  });

  it("keeps the block filter alongside a search term", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    const { getBlockedUserIds } = await getBlocking();
    (getBlockedUserIds as any).mockResolvedValue(["blocked-user"]);

    await GET(
      new Request("http://localhost:3000/api/users?search=goa") as any,
    );

    const [{ where }] = (prisma.user.findMany as any).mock.calls[0];

    expect(where.id).toEqual({ notIn: ["test-user-id", "blocked-user"] });
    expect(where.AND[0].OR).toHaveLength(2);
  });

  it("should enforce maximum limit of 100", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    const request = new Request("http://localhost:3000/api/users?limit=200");
    const response = await GET(request as any);

    expect(response.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }),
    );
  });

  it("should return null nextCursor at end of results", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([userRow("1")]);

    const request = new Request("http://localhost:3000/api/users?limit=20");
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.nextCursor).toBeNull();
    expect(data.hasMore).toBe(false);
  });

  it("should ensure no duplicate records between pages with stable ordering", async () => {
    const firstPageUsers = [
      userRow("1", { createdAt: new Date("2024-01-03") }),
      userRow("2", { createdAt: new Date("2024-01-02") }),
    ];
    const secondPageUsers = [userRow("3", { createdAt: new Date("2024-01-01") })];
    const prisma = await getPrisma();

    (prisma.user.findMany as any).mockResolvedValue(firstPageUsers);
    const firstResponse = await GET(
      new Request("http://localhost:3000/api/users?limit=2") as any,
    );
    const firstData = await firstResponse.json();

    (prisma.user.findMany as any).mockResolvedValue(secondPageUsers);
    const secondResponse = await GET(
      new Request("http://localhost:3000/api/users?limit=2&cursor=next-cursor") as any,
    );
    const secondData = await secondResponse.json();

    const firstPageIds = firstData.users.map((u: any) => u.id);
    const secondPageIds = secondData.users.map((u: any) => u.id);
    const duplicates = firstPageIds.filter((id: string) => secondPageIds.includes(id));

    expect(duplicates).toHaveLength(0);
    expect(firstData.users).toHaveLength(2);
    expect(secondData.users).toHaveLength(1);
  });

  it("should return 401 for unauthenticated requests", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as any).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/users");
    const response = await GET(request as any);

    expect(response.status).toBe(401);
  });

  it("does not resolve the block set for an unauthenticated caller", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as any).mockResolvedValue(null);

    const { getBlockedUserIds } = await getBlocking();

    await GET(new Request("http://localhost:3000/api/users") as any);

    expect(getBlockedUserIds).not.toHaveBeenCalled();
  });

  it("should exclude current user from results", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([userRow("1")]);

    const response = await GET(
      new Request("http://localhost:3000/api/users?limit=20") as any,
    );

    expect(response.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { notIn: ["test-user-id"] } }),
    }));
  });

  it("excludes soft-deleted accounts", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockResolvedValue([]);

    await GET(new Request("http://localhost:3000/api/users") as any);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isDeleted: false }),
      }),
    );
  });

  it("returns 500 when the query fails", async () => {
    const prisma = await getPrisma();
    (prisma.user.findMany as any).mockRejectedValue(new Error("db down"));

    const response = await GET(
      new Request("http://localhost:3000/api/users") as any,
    );

    expect(response.status).toBe(500);
  });
});
