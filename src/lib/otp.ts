import { randomInt, createHash, timingSafeEqual } from "crypto";

/**
 * Generate a 6-digit OTP using a cryptographically secure RNG.
 */
export function generateOTP(): string {
  // randomInt is a CSPRNG; the upper bound is exclusive, so this yields 100000-999999.
  return randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP for storage, so a read of the users table never exposes a live code.
 */
export function hashOTP(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

/**
 * Constant-time comparison of a submitted OTP against a stored hash.
 */
export function verifyOTP(otp: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const submitted = Buffer.from(hashOTP(otp), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return submitted.length === stored.length && timingSafeEqual(submitted, stored);
}

/**
 * Validate OTP format
 */
export function isValidOTPFormat(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}
