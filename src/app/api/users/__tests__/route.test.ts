import { describe, expect, it, beforeEach, vi } from "vitest";
import { GET } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "test-user-id", email: "test@example.com", name: "Test User" },
  })),
}));

vi.mock("@/lib/pagination", () => ({
  parsePaginationParams: vi.fn((searchParams) => ({
    limit: Math.min(Number.parseInt(searchParams.get("limit") || "20", 10), 100),
    cursor: searchParams.get("cursor") ? { timestamp: "2024-01-01T00:00:00.000Z", id: "cursor-id" } : null,
  })),
  buildTimestampCursorWhere: vi.fn((cursor) => cursor ? {
    OR: [
      { createdAt: { lt: new Date(cursor.timestamp) } },
      { createdAt: new Date(cursor.timestamp), id: { lt: cursor.id } },
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
}));

vi.mock("@/lib/api-response", () => ({
  apiJson: (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }),
  apiError: () => new Response(JSON.stringify({ error: "error" }), { status: 401, headers: { "Content-Type": "application/json" } }),
}));

vi.mock("@/lib/api-error", () => ({
  API_ERROR_CODES: { UNAUTHORIZED: "UNAUTHORIZED", VALIDATION_ERROR: "VALIDATION_ERROR", INTERNAL_ERROR: "INTERNAL_ERROR" },
  logApiError: vi.fn(),
}));

vi.mock("@/lib/request-id", () => ({ getRequestId: () => "test-request-id" }));

vi.mock("@/lib/prisma", () => ({
  default: { user: { findMany: vi.fn() } },
}));

describe("GET /api/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return first page of users without cursor", async () => {
    const mockUsers = [
      { id: "1", name: "User 1", email: "user1@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-02") },
      { id: "2", name: "User 2", email: "user2@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-01") },
    ];

    const prisma = (await import("@/lib/prisma")).default;
    (prisma.user.findMany as any).mockResolvedValue(mockUsers);

    const request = new Request("http://localhost:3000/api/users?limit=20");
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.users).toEqual(mockUsers);
    expect(data.nextCursor).toBeNull();
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { isDeleted: false, id: { not: "test-user-id" } },
      select: { id: true, name: true, email: true, image: true, bio: true, location: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
  });

  it("should return subsequent page using nextCursor", async () => {
    const mockUsers = [{ id: "3", name: "User 3", email: "user3@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-03") }];
    const prisma = (await import("@/lib/prisma")).default;
    (prisma.user.findMany as any).mockResolvedValue(mockUsers);

    const request = new Request("http://localhost:3000/api/users?limit=20&cursor=encoded-cursor");
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.users).toEqual(mockUsers);
  });

  it("should apply search filter consistently before pagination", async () => {
    const mockUsers = [{ id: "1", name: "Ayush", email: "ayush@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-02") }];
    const prisma = (await import("@/lib/prisma")).default;
    (prisma.user.findMany as any).mockResolvedValue(mockUsers);

    const request = new Request("http://localhost:3000/api/users?search=ayush&limit=20");
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.users).toEqual(mockUsers);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        isDeleted: false,
        id: { not: "test-user-id" },
        OR: [
          { name: { contains: "ayush", mode: "insensitive" } },
          { email: { contains: "ayush", mode: "insensitive" } },
          { location: { contains: "ayush", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, image: true, bio: true, location: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
  });

  it("should enforce maximum limit of 100", async () => {
    const prisma = (await import("@/lib/prisma")).default;
    (prisma.user.findMany as any).mockResolvedValue([]);

    const request = new Request("http://localhost:3000/api/users?limit=200");
    const response = await GET(request as any);

    expect(response.status).toBe(200);
  });

  it("should return null nextCursor at end of results", async () => {
    const mockUsers = [{ id: "1", name: "User 1", email: "user1@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-01") }];
    const prisma = (await import("@/lib/prisma")).default;
    (prisma.user.findMany as any).mockResolvedValue(mockUsers);

    const request = new Request("http://localhost:3000/api/users?limit=20");
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.nextCursor).toBeNull();
  });

  it("should ensure no duplicate records between pages with stable ordering", async () => {
    const firstPageUsers = [
      { id: "1", name: "User 1", email: "user1@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-03") },
      { id: "2", name: "User 2", email: "user2@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-02") },
    ];
    const secondPageUsers = [{ id: "3", name: "User 3", email: "user3@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-01") }];
    const prisma = (await import("@/lib/prisma")).default;

    (prisma.user.findMany as any).mockResolvedValue(firstPageUsers);
    const firstRequest = new Request("http://localhost:3000/api/users?limit=2");
    const firstResponse = await GET(firstRequest as any);
    const firstData = await firstResponse.json();

    (prisma.user.findMany as any).mockResolvedValue(secondPageUsers);
    const secondRequest = new Request("http://localhost:3000/api/users?limit=2&cursor=next-cursor");
    const secondResponse = await GET(secondRequest as any);
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

    (auth as any).mockResolvedValue({ user: { id: "test-user-id", email: "test@example.com", name: "Test User" } });
  });

  it("should exclude current user from results", async () => {
    const mockUsers = [{ id: "1", name: "User 1", email: "user1@example.com", image: null, bio: null, location: null, createdAt: new Date("2024-01-01") }];
    const prisma = (await import("@/lib/prisma")).default;
    (prisma.user.findMany as any).mockResolvedValue(mockUsers);

    const request = new Request("http://localhost:3000/api/users?limit=20");
    const response = await GET(request as any);

    expect(response.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: "test-user-id" } }),
    }));
  });
});
