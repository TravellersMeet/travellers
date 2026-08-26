import { describe, expect, it } from "vitest";

import {
  ageSchema,
  onboardingProfileSchema,
  PROFILE_LIMITS,
  socialLinkSchema,
  toProfileUpdateData,
} from "@/lib/validation/profile";

function parse(input: unknown) {
  return onboardingProfileSchema.safeParse(input);
}

function expectFieldError(
  input: unknown,
  field: string,
) {
  const result = parse(input);

  expect(result.success).toBe(false);

  if (result.success) {
    return;
  }

  const paths = result.error.issues.map((issue) =>
    issue.path.join("."),
  );

  expect(paths.some((path) => path.startsWith(field))).toBe(
    true,
  );
}

describe("onboardingProfileSchema", () => {
  it("accepts an empty payload so partial onboarding still works", () => {
    const result = parse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({});
  });

  it("accepts a fully populated payload", () => {
    const result = parse({
      name: "Asha Menon",
      bio: "Slow traveller, mostly trains.",
      location: "Pune",
      homeLocation: "Kochi",
      budgetRange: "mid",
      gender: "female",
      travelStyle: "backpacking",
      languages: ["Malayalam", "English"],
      travelInterests: ["food", "trekking"],
      accommodationPrefs: ["hostel"],
      socialLinks: ["https://example.com/asha"],
      age: 29,
    });

    expect(result.success).toBe(true);
  });

  describe("name", () => {
    it("rejects an empty name instead of blanking the column", () => {
      expectFieldError({ name: "" }, "name");
      expectFieldError({ name: "   " }, "name");
    });

    it("rejects a name past the maximum length", () => {
      expectFieldError(
        { name: "a".repeat(PROFILE_LIMITS.nameMax + 1) },
        "name",
      );
    });

    it("collapses internal whitespace", () => {
      const result = parse({ name: "  Asha   Menon  " });

      expect(result.success && result.data.name).toBe(
        "Asha Menon",
      );
    });
  });

  describe("free-text fields", () => {
    it("rejects a bio past the maximum length", () => {
      expectFieldError(
        { bio: "x".repeat(PROFILE_LIMITS.bioMax + 1) },
        "bio",
      );
    });

    it("accepts a bio exactly at the maximum length", () => {
      const result = parse({
        bio: "x".repeat(PROFILE_LIMITS.bioMax),
      });

      expect(result.success).toBe(true);
    });

    it("rejects non-string values", () => {
      expectFieldError({ location: 42 }, "location");
      expectFieldError({ travelStyle: null }, "travelStyle");
    });
  });

  describe("tag lists", () => {
    it("rejects a string where an array is expected", () => {
      expectFieldError({ languages: "hindi" }, "languages");
    });

    it("rejects non-string entries that Prisma would choke on", () => {
      expectFieldError({ languages: [1, 2, 3] }, "languages");
    });

    it("rejects more entries than the per-list cap", () => {
      expectFieldError(
        {
          travelInterests: Array.from(
            { length: PROFILE_LIMITS.tagsPerList + 1 },
            (_, index) => `interest-${index}`,
          ),
        },
        "travelInterests",
      );
    });

    it("rejects an entry past the per-entry cap", () => {
      expectFieldError(
        {
          accommodationPrefs: [
            "x".repeat(PROFILE_LIMITS.tagMax + 1),
          ],
        },
        "accommodationPrefs",
      );
    });

    it("drops blank entries left behind by the form", () => {
      const result = parse({
        languages: ["Hindi", "   ", "", "English"],
      });

      expect(result.success && result.data.languages).toEqual(
        ["Hindi", "English"],
      );
    });
  });

  describe("socialLinks", () => {
    it("accepts http and https links", () => {
      expect(
        socialLinkSchema.safeParse("http://example.com")
          .success,
      ).toBe(true);
      expect(
        socialLinkSchema.safeParse("https://example.com/a")
          .success,
      ).toBe(true);
    });

    it("rejects javascript: and data: URLs", () => {
      expect(
        socialLinkSchema.safeParse("javascript:alert(1)")
          .success,
      ).toBe(false);
      expect(
        socialLinkSchema.safeParse(
          "data:text/html,<script>alert(1)</script>",
        ).success,
      ).toBe(false);
    });

    it("rejects strings that are not URLs at all", () => {
      expect(
        socialLinkSchema.safeParse("not a link").success,
      ).toBe(false);
    });

    it("rejects more links than the cap allows", () => {
      expectFieldError(
        {
          socialLinks: Array.from(
            { length: PROFILE_LIMITS.socialLinks + 1 },
            (_, index) => `https://example.com/${index}`,
          ),
        },
        "socialLinks",
      );
    });
  });

  describe("age", () => {
    it("accepts a numeric string", () => {
      expect(ageSchema.safeParse("29")).toMatchObject({
        success: true,
        data: 29,
      });
    });

    it("refuses to coerce a partially numeric string", () => {
      expect(ageSchema.safeParse("42abc").success).toBe(
        false,
      );
    });

    it("rejects fractional ages", () => {
      expect(ageSchema.safeParse(29.5).success).toBe(false);
    });

    it("rejects ages outside the plausible range", () => {
      expect(
        ageSchema.safeParse(PROFILE_LIMITS.ageMin - 1)
          .success,
      ).toBe(false);
      expect(
        ageSchema.safeParse(PROFILE_LIMITS.ageMax + 1)
          .success,
      ).toBe(false);
      expect(ageSchema.safeParse(-5).success).toBe(false);
    });

    it("accepts the boundaries themselves", () => {
      expect(
        ageSchema.safeParse(PROFILE_LIMITS.ageMin).success,
      ).toBe(true);
      expect(
        ageSchema.safeParse(PROFILE_LIMITS.ageMax).success,
      ).toBe(true);
    });
  });

  it("rejects unknown keys so client drift is visible", () => {
    const result = parse({ role: "ADMIN" });

    expect(result.success).toBe(false);
  });

  it("does not let the payload set onboarded directly", () => {
    expect(parse({ onboarded: false }).success).toBe(false);
  });
});

describe("toProfileUpdateData", () => {
  it("keeps only the fields the client actually sent", () => {
    const parsed = onboardingProfileSchema.parse({
      name: "Asha Menon",
      bio: "Trains.",
    });

    expect(toProfileUpdateData(parsed)).toEqual({
      name: "Asha Menon",
      bio: "Trains.",
    });
  });

  it("returns an empty object for an empty payload", () => {
    expect(
      toProfileUpdateData(
        onboardingProfileSchema.parse({}),
      ),
    ).toEqual({});
  });
});
