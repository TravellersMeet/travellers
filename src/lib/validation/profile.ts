import { z } from "zod";

/**
 * Field bounds shared by every endpoint that writes to the user profile.
 *
 * Onboarding and `PATCH /api/user/profile` write the same columns, so the
 * limits live here rather than being restated (and drifting) per route.
 */
export const PROFILE_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  bioMax: 1_000,
  locationMax: 120,
  homeLocationMax: 120,
  budgetRangeMax: 60,
  genderMax: 40,
  travelStyleMax: 60,
  /** Applies to languages / travelInterests / accommodationPrefs entries. */
  tagMax: 60,
  tagsPerList: 25,
  socialLinkMax: 300,
  socialLinks: 10,
  ageMin: 13,
  ageMax: 120,
} as const;

/** Protocols we are willing to render as a clickable profile link. */
const ALLOWED_LINK_PROTOCOLS = ["http:", "https:"];

/**
 * Collapses runs of whitespace so `"Goa   Trip"` and `"Goa Trip"` are stored
 * identically, and strips the leading/trailing padding that otherwise defeats
 * the `min` checks below.
 */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** A trimmed, length-capped free-text field. */
function boundedText(max: number) {
  return z
    .string()
    .transform(collapseWhitespace)
    .pipe(z.string().max(max, `Must be ${max} characters or fewer`));
}

/**
 * A bounded list of short tags. Empty entries are dropped rather than
 * rejected, because the onboarding UI submits a blank trailing input whenever
 * the user has not finished typing the next tag.
 */
function tagList(max: number, perList: number) {
  return z
    .array(z.string())
    .transform((values) =>
      values
        .map(collapseWhitespace)
        .filter((value) => value.length > 0),
    )
    .pipe(
      z
        .array(
          z
            .string()
            .max(max, `Each entry must be ${max} characters or fewer`),
        )
        .max(perList, `Provide at most ${perList} entries`),
    );
}

/**
 * Social links are rendered as anchors on the public profile card, so the
 * protocol has to be checked here — a stored `javascript:` URL would become a
 * live handler the moment somebody views the profile.
 */
export const socialLinkSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, "Link cannot be empty")
      .max(
        PROFILE_LIMITS.socialLinkMax,
        `Link must be ${PROFILE_LIMITS.socialLinkMax} characters or fewer`,
      ),
  )
  .refine((value) => {
    let parsed: URL;

    try {
      parsed = new URL(value);
    } catch {
      return false;
    }

    return ALLOWED_LINK_PROTOCOLS.includes(parsed.protocol);
  }, "Links must be a valid http(s) URL");

/**
 * Age arrives as a number from the onboarding form and as a string from the
 * older profile screen, so both are accepted — but only when the string is
 * entirely numeric. `parseInt` would happily turn `"42abc"` into `42`.
 */
export const ageSchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const raw =
      typeof value === "number" ? value : Number(value.trim());

    if (!Number.isInteger(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Age must be a whole number",
      });

      return z.NEVER;
    }

    return raw;
  })
  .pipe(
    z
      .number()
      .min(PROFILE_LIMITS.ageMin, `Age must be at least ${PROFILE_LIMITS.ageMin}`)
      .max(PROFILE_LIMITS.ageMax, `Age must be at most ${PROFILE_LIMITS.ageMax}`),
  );

export const nameSchema = z
  .string()
  .transform(collapseWhitespace)
  .pipe(
    z
      .string()
      .min(
        PROFILE_LIMITS.nameMin,
        `Name must be at least ${PROFILE_LIMITS.nameMin} characters`,
      )
      .max(
        PROFILE_LIMITS.nameMax,
        `Name must be ${PROFILE_LIMITS.nameMax} characters or fewer`,
      ),
  );

/**
 * Every field is optional: onboarding is completed progressively and the
 * client submits only the steps the user actually filled in. What is *not*
 * optional is that anything present has to be well formed.
 *
 * `.strict()` is deliberate — an unknown key almost always means the client
 * and the server have drifted, and silently ignoring it hides the bug.
 */
export const onboardingProfileSchema = z
  .object({
    name: nameSchema.optional(),
    bio: boundedText(PROFILE_LIMITS.bioMax).optional(),
    location: boundedText(PROFILE_LIMITS.locationMax).optional(),
    homeLocation: boundedText(
      PROFILE_LIMITS.homeLocationMax,
    ).optional(),
    budgetRange: boundedText(
      PROFILE_LIMITS.budgetRangeMax,
    ).optional(),
    gender: boundedText(PROFILE_LIMITS.genderMax).optional(),
    travelStyle: boundedText(
      PROFILE_LIMITS.travelStyleMax,
    ).optional(),
    languages: tagList(
      PROFILE_LIMITS.tagMax,
      PROFILE_LIMITS.tagsPerList,
    ).optional(),
    travelInterests: tagList(
      PROFILE_LIMITS.tagMax,
      PROFILE_LIMITS.tagsPerList,
    ).optional(),
    accommodationPrefs: tagList(
      PROFILE_LIMITS.tagMax,
      PROFILE_LIMITS.tagsPerList,
    ).optional(),
    socialLinks: z
      .array(socialLinkSchema)
      .max(
        PROFILE_LIMITS.socialLinks,
        `Provide at most ${PROFILE_LIMITS.socialLinks} links`,
      )
      .optional(),
    age: ageSchema.optional(),
  })
  .strict();

export type OnboardingProfileInput = z.infer<
  typeof onboardingProfileSchema
>;

/**
 * Drops keys the client did not send so Prisma leaves those columns alone.
 * `exactOptionalPropertyTypes` is not enabled in this project, so an explicit
 * `undefined` would otherwise be indistinguishable from an absent key.
 *
 * Typed against the parsed shape rather than `OnboardingProfileInput`: the
 * schema transforms `age`, so the wrapper's inferred payload type keeps the
 * pre-transform union and would not line up with the output type here.
 */
export function toProfileUpdateData(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined,
    ),
  );
}
