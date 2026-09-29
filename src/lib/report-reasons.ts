/**
 * The closed set of moderation report categories.
 *
 * `Report.reason` is a plain `String` column and the API accepted any
 * non-empty value of any length, so the moderation queue could not be grouped,
 * counted or filtered: "harassment", "Harassment " and "harrassment" were
 * three different categories, and a script could write megabytes into the
 * column.
 *
 * The codes are stored; the labels are what the UI shows. Keeping the two
 * apart means the wording on the report form can be reworded without
 * rewriting historical rows.
 */
export const REPORT_REASONS = {
  HARASSMENT: "Harassment or abusive language",
  SPAM: "Spam or scams",
  SCAM: "Fraud or financial scam",
  IMPERSONATION: "Fake profile or impersonation",
  INAPPROPRIATE_CONTENT: "Inappropriate behaviour or content",
  SAFETY_CONCERN: "Safety concern",
  OTHER: "Something else",
} as const;

export type ReportReasonCode = keyof typeof REPORT_REASONS;

export const REPORT_REASON_CODES = Object.keys(
  REPORT_REASONS,
) as ReportReasonCode[];

/**
 * The free-text values the report form used to submit.
 *
 * The `<select>` in ReportUserModal posted its display strings straight to the
 * API, so those exact strings are what existing rows contain and what any
 * client still running the previous bundle will send. Mapping them keeps
 * in-flight submissions working through a deploy instead of turning them into
 * 400s.
 */
const LEGACY_REASON_ALIASES: Record<string, ReportReasonCode> = {
  "inappropriate behavior": "INAPPROPRIATE_CONTENT",
  "inappropriate behaviour": "INAPPROPRIATE_CONTENT",
  "spam or scams": "SPAM",
  spam: "SPAM",
  "fake profile": "IMPERSONATION",
  "fake profile / impersonation": "IMPERSONATION",
  harassment: "HARASSMENT",
  "harassment or abusive language": "HARASSMENT",
  other: "OTHER",
};

/**
 * Longest `details` body accepted.
 *
 * `details` is `@db.Text`, so without a cap a single request could store
 * megabytes that a moderator then has to page through. A thousand characters
 * is several paragraphs — comfortably more than the three-row textarea on the
 * form invites, and far short of an abuse vector.
 */
export const MAX_REPORT_DETAILS_LENGTH = 1000;

/**
 * How long a reporter must wait before filing against the same person again.
 *
 * Nothing previously stopped duplicates: within the 5-per-10-minutes rate
 * limit a reporter could file 720 identical reports a day against one user.
 * That buries a legitimate account in volume and leaves no signal separating
 * it from 720 genuine complaints.
 */
export const DUPLICATE_REPORT_WINDOW_HOURS = 24;

export function isReportReasonCode(
  value: string,
): value is ReportReasonCode {
  return Object.prototype.hasOwnProperty.call(
    REPORT_REASONS,
    value,
  );
}

/**
 * Resolves a submitted reason to a canonical code.
 *
 * Accepts a code directly, or one of the legacy display strings, in any
 * casing and with surrounding whitespace. Returns `null` for anything else so
 * the caller can reject it rather than silently storing an unknown category.
 */
export function normalizeReportReason(
  value: string,
): ReportReasonCode | null {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  const upper = trimmed.toUpperCase();

  if (isReportReasonCode(upper)) {
    return upper;
  }

  return (
    LEGACY_REASON_ALIASES[trimmed.toLowerCase()] ?? null
  );
}

export function reportReasonLabel(
  code: ReportReasonCode,
): string {
  return REPORT_REASONS[code];
}
