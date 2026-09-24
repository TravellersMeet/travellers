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

/**
 * How long a freshly issued code stays valid.
 *
 * The 10-minute window was duplicated as a literal in both the signup and the
 * resend route. It is the basis for the resend cooldown below, so the two must
 * not be able to drift.
 */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Minimum gap between two codes being mailed to the same address.
 *
 * The per-request rate limit is keyed on `email|ip`, so rotating source
 * addresses multiplies it directly and nothing in the database caps how often
 * a single mailbox is written to. This cooldown is derived from stored state,
 * so it holds regardless of where the request came from — and regardless of
 * whether Redis is reachable, since the limiter fails open.
 */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * When the currently stored code was issued.
 *
 * There is no `otpIssuedAt` column; the issue time is recoverable from the
 * expiry because every code is written with the same TTL.
 */
export function otpIssuedAt(
  otpExpires: Date | null | undefined,
): Date | null {
  if (!otpExpires) {
    return null;
  }

  return new Date(otpExpires.getTime() - OTP_TTL_MS);
}

export interface OTPResendDecision {
  allowed: boolean;
  /** Whole seconds the caller must wait. Zero when `allowed`. */
  retryAfterSeconds: number;
}

/**
 * Whether a new code may be mailed, given the expiry currently on record.
 */
export function canResendOTP(
  otpExpires: Date | null | undefined,
  now: Date = new Date(),
): OTPResendDecision {
  const issuedAt = otpIssuedAt(otpExpires);

  if (!issuedAt) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const elapsed = now.getTime() - issuedAt.getTime();

  // A clock skew or a hand-edited row can put the issue time in the future.
  // Treat that as "just issued" rather than trusting it to unlock a resend.
  if (elapsed >= OTP_RESEND_COOLDOWN_MS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - elapsed) / 1000,
      ),
    ),
  };
}
