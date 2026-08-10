import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEVELOPMENT_SALT_ROUNDS,
  PRODUCTION_SALT_ROUNDS,
  getPasswordSaltRounds,
  hashPassword,
  verifyOptionalPassword,
  verifyPassword,
} from "@/lib/password";

/**
 * `getPasswordSaltRounds` reads NODE_ENV at call time, so stubbing the env is
 * enough to exercise the production branch from the test suite.
 */
function setNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value as never);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPasswordSaltRounds", () => {
  it("uses the stronger cost factor in production", () => {
    setNodeEnv("production");

    expect(getPasswordSaltRounds()).toBe(
      PRODUCTION_SALT_ROUNDS,
    );
  });

  it("uses the cheaper cost factor outside production", () => {
    setNodeEnv("test");

    expect(getPasswordSaltRounds()).toBe(
      DEVELOPMENT_SALT_ROUNDS,
    );
  });

  it("keeps production strictly stronger than development", () => {
    expect(PRODUCTION_SALT_ROUNDS).toBeGreaterThan(
      DEVELOPMENT_SALT_ROUNDS,
    );
  });
});

describe("hashPassword", () => {
  it("produces a bcrypt hash carrying the configured cost", async () => {
    setNodeEnv("test");

    const hashed = await hashPassword("correct horse battery");

    // bcrypt encodes the cost in the hash itself: $2a$<cost>$...
    expect(hashed).toMatch(
      new RegExp(`^\\$2[aby]\\$${DEVELOPMENT_SALT_ROUNDS}\\$`),
    );
  });

  it("salts, so the same password hashes differently each time", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");

    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("accepts the matching password", async () => {
    const hashed = await hashPassword("s3cret-passphrase");

    await expect(
      verifyPassword("s3cret-passphrase", hashed),
    ).resolves.toBe(true);
  });

  it("rejects a different password", async () => {
    const hashed = await hashPassword("s3cret-passphrase");

    await expect(
      verifyPassword("wrong-passphrase", hashed),
    ).resolves.toBe(false);
  });

  it("verifies a hash written at the production cost factor", async () => {
    // A hash created before a cost-factor change must still validate — bcrypt
    // reads the cost out of the stored hash.
    setNodeEnv("production");
    const productionHash = await hashPassword("portable");

    setNodeEnv("test");
    await expect(
      verifyPassword("portable", productionHash),
    ).resolves.toBe(true);
  });
});

describe("verifyOptionalPassword", () => {
  it("behaves like verifyPassword when a hash exists", async () => {
    const hashed = await hashPassword("s3cret-passphrase");

    await expect(
      verifyOptionalPassword("s3cret-passphrase", hashed),
    ).resolves.toBe(true);
    await expect(
      verifyOptionalPassword("nope", hashed),
    ).resolves.toBe(false);
  });

  it("returns false for an account with no password hash", async () => {
    await expect(
      verifyOptionalPassword("anything", null),
    ).resolves.toBe(false);
    await expect(
      verifyOptionalPassword("anything", undefined),
    ).resolves.toBe(false);
    await expect(
      verifyOptionalPassword("anything", ""),
    ).resolves.toBe(false);
  });

  it("still spends a comparison when there is no hash", async () => {
    // The point of the dummy comparison: an OAuth-only account must not answer
    // measurably faster than a wrong password would.
    const realHash = await hashPassword("s3cret-passphrase");

    const wrongPasswordStart = performance.now();
    await verifyOptionalPassword("wrong", realHash);
    const wrongPasswordMs = performance.now() - wrongPasswordStart;

    // Warm the cached dummy hash so this measures the comparison, not the
    // one-off hash generation.
    await verifyOptionalPassword("warm-up", null);

    const noHashStart = performance.now();
    await verifyOptionalPassword("wrong", null);
    const noHashMs = performance.now() - noHashStart;

    // A bare `return false` lands in microseconds; a bcrypt comparison at the
    // test cost factor takes milliseconds. Comparing against a fraction of the
    // real path keeps this from being timing-flaky.
    expect(noHashMs).toBeGreaterThan(wrongPasswordMs / 10);
  });
});
