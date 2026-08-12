import { NextRequest } from "next/server";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { GET } from "@/app/api/health/route";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  default: {
    ping: vi.fn(),
  },
}));

describe("GET /api/health", () => {
  it("returns 200 without querying dependencies", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/health",
        {
          headers: {
            "X-Request-ID": "req_healthcheck123",
          },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store",
    );
    expect(response.headers.get("X-Request-ID")).toBe(
      "req_healthcheck123",
    );
    expect(body).toMatchObject({
      status: "healthy",
      requestId: "req_healthcheck123",
    });
    expect(body.timestamp).toEqual(expect.any(String));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis?.ping).not.toHaveBeenCalled();
  });
});
