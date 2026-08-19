import { compare, hash } from "bcryptjs";

/**
 * bcrypt cost factor, in one place.
 *
 * The value was duplicated as a literal in three routes — signup,
 * reset-password and change-password — and change-password drifted: it hashed
 * with a hardcoded `10` while the other two used `12` in production. Anybody
 * who changed their password in production was silently downgraded to a hash
 * roughly 4x cheaper to attack offline, and nothing surfaced it.
 *
 * Production runs at 12; development and test stay at 10 so the suite and the
 * local signup flow are not dominated by bcrypt.
 */
export const PRODUCTION_SALT_ROUNDS = 12;
export const DEVELOPMENT_SALT_ROUNDS = 10;

export function getPasswordSaltRounds(): number {
  return process.env.NODE_ENV === "production"
    ? PRODUCTION_SALT_ROUNDS
    : DEVELOPMENT_SALT_ROUNDS;
}

export async function hashPassword(
  plaintext: string,
): Promise<string> {
  return hash(plaintext, getPasswordSaltRounds());
}

export async function verifyPassword(
  plaintext: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(plaintext, passwordHash);
}

/**
 * Cached hash of a value nobody can supply, used to keep the "this account has
 * no password" branch doing the same work as a real comparison.
 *
 * Without it, an OAuth-only account answers immediately while a wrong password
 * costs a full bcrypt round, so response time alone distinguishes the two
 * cases. Computed once per process and reused.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hash(
      "password-comparison-placeholder",
      getPasswordSaltRounds(),
    );
  }

  return dummyHashPromise;
}

/**
 * Compare a candidate password against a hash that may be absent.
 *
 * Always returns `false` when `passwordHash` is null, but spends a comparison
 * doing so.
 */
export async function verifyOptionalPassword(
  plaintext: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!passwordHash) {
    await compare(plaintext, await getDummyHash());
    return false;
  }

  return verifyPassword(plaintext, passwordHash);
}
