import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { GET } from "@/app/api/ready/route";
import { runReadinessChecks } from "@/lib/health-checks";

vi.mock("@/lib/health-checks", async () => {
  const actual =
    await vi.importActual<
      typeof import("@/lib/health-checks")
    >("@/lib/health-checks");

  return {
    ...actual,
    runReadinessChecks: vi.fn(),
  };
});

function createRequest() {
  return new NextRequest(
    "http://localhost/api/ready",
    {
      headers: {
        "X-Request-ID": "req_readiness123",
      },
    },
  );
}

describe("GET /api/ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ready when required dependencies are available", async () => {
    vi.mocked(runReadinessChecks).mockResolvedValue({
      database: {
        status: "up",
        latencyMs: 8,
        required: true,
      },
      redis: {
        status: "up",
        latencyMs: 4,
        required: false,
      },
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "no-store",
    );
    expect(body).toMatchObject({
      status: "ready",
      requestId: "req_readiness123",
    });
  });

  it("returns degraded when optional Redis is unavailable", async () => {
    vi.mocked(runReadinessChecks).mockResolvedValue({
      database: {
        status: "up",
        latencyMs: 5,
        required: true,
      },
      redis: {
        status: "down",
        latencyMs: 2,
        required: false,
      },
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
  });

  it("returns 503 when PostgreSQL is unavailable", async () => {
    vi.mocked(runReadinessChecks).mockResolvedValue({
      database: {
        status: "down",
        latencyMs: 3,
        required: true,
      },
      redis: {
        status: "skipped",
        latencyMs: 0,
        required: false,
      },
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
    expect(JSON.stringify(body)).not.toContain(
      "password",
    );
  });
});
