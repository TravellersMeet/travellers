import { describe, expect, it } from "vitest";
import { generateOTP, hashOTP, verifyOTP, isValidOTPFormat } from "../otp";

describe("otp", () => {
  it("generateOTP returns a 6-digit numeric code", () => {
    for (let i = 0; i < 200; i++) {
      const otp = generateOTP();
      expect(isValidOTPFormat(otp)).toBe(true);
      const n = Number(otp);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });

  it("hashOTP is deterministic and never returns the plaintext", () => {
    const otp = "123456";
    const hash = hashOTP(otp);
    expect(hash).toBe(hashOTP(otp));
    expect(hash).not.toBe(otp);
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("verifyOTP accepts the matching code and rejects a wrong one", () => {
    const otp = generateOTP();
    const stored = hashOTP(otp);
    expect(verifyOTP(otp, stored)).toBe(true);
    expect(verifyOTP("000000", stored)).toBe(false);
  });

  it("verifyOTP rejects null/empty stored hashes and legacy plaintext", () => {
    expect(verifyOTP("123456", null)).toBe(false);
    expect(verifyOTP("123456", undefined)).toBe(false);
    expect(verifyOTP("123456", "")).toBe(false);
    expect(verifyOTP("123456", "123456")).toBe(false); // legacy plaintext no longer matches
  });
});
