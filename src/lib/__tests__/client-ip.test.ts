import { getClientIp } from "@/lib/client-ip";
import { describe, expect, it } from "vitest";

function requestWithHeaders(
  headers: Record<string, string>,
): Parameters<typeof getClientIp>[0] {
  return {
    headers: new Headers(headers),
  } as Parameters<typeof getClientIp>[0];
}

describe("getClientIp", () => {
  it("uses the rightmost (nearest-hop) forwarded address, not the spoofable leftmost", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "203.0.113.5, 10.0.0.2",
    });

    expect(getClientIp(request)).toBe("10.0.0.2");
  });

  it("prefers trusted platform headers over a spoofable X-Forwarded-For", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "198.51.100.7",
    });

    expect(getClientIp(request)).toBe("198.51.100.7");
  });

  it("falls back to platform IP headers", () => {
    const request = requestWithHeaders({
      "x-real-ip": "198.51.100.7",
    });

    expect(getClientIp(request)).toBe("198.51.100.7");
  });

  it("ignores malformed forwarded values", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "not-an-ip",
      "cf-connecting-ip": "192.0.2.20",
    });

    expect(getClientIp(request)).toBe("192.0.2.20");
  });

  it("returns an anonymous fallback when no IP is available", () => {
    expect(getClientIp(requestWithHeaders({}))).toBe("unknown");
  });
});
