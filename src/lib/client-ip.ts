import { isIP } from "node:net";
import type { NextRequest } from "next/server";

const UNKNOWN_CLIENT = "unknown";

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const candidate = value.trim();

  if (!candidate) {
    return null;
  }

  const withoutPort =
    candidate.startsWith("[") && candidate.includes("]")
      ? candidate.slice(1, candidate.indexOf("]"))
      : candidate.replace(/^::ffff:/, "");

  if (isIP(withoutPort)) {
    return withoutPort;
  }

  const ipv4WithPort = withoutPort.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort && isIP(ipv4WithPort[1])) {
    return ipv4WithPort[1];
  }

  return null;
}

/**
 * Returns the first valid client IP exposed by the deployment platform.
 * Raw header values are never used directly as Redis keys.
 */
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    for (const value of forwardedFor.split(",")) {
      const parsed = normalizeIp(value);
      if (parsed) {
        return parsed;
      }
    }
  }

  const platformHeaders = [
    request.headers.get("x-real-ip"),
    request.headers.get("cf-connecting-ip"),
    request.headers.get("fly-client-ip"),
  ];

  for (const value of platformHeaders) {
    const parsed = normalizeIp(value);
    if (parsed) {
      return parsed;
    }
  }

  return UNKNOWN_CLIENT;
}
