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
  // Prefer platform-set headers first: a CDN/proxy (Vercel, Cloudflare, Fly)
  // overwrites these, so — unlike the client-supplied X-Forwarded-For — they
  // can't be spoofed by the caller.
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

  // Fall back to X-Forwarded-For, taking the RIGHTMOST valid entry — the hop
  // closest to the server. The leftmost entry is the attacker-controllable end
  // of the chain; keying rate limits on it let a caller rotate it per request
  // and never trip the limit.
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const parts = forwardedFor.split(",");
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const parsed = normalizeIp(parts[i]);
      if (parsed) {
        return parsed;
      }
    }
  }

  return UNKNOWN_CLIENT;
}
