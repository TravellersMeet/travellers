import { createHash } from "node:crypto";

export const MAX_TICKET_FILE_SIZE = 10 * 1024 * 1024;
export const SUPPORTED_TICKET_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export interface TicketVerificationInput {
  bytes: Buffer;
  mimeType: string;
  destination: string;
  departureDate: Date;
}

export interface TicketVerificationResult {
  status: "PASSED" | "SUSPICIOUS" | "FAILED";
  score: number;
  reason: string;
  ocrExtractedText: string | null;
  metadataHash: string;
  aiDetectionScore: number | null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasMagicBytes(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png")
    return bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/webp")
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "application/pdf")
    return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
}

function dateMatches(text: string, date: Date): boolean {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = String(date.getUTCFullYear());
  return [
    `${d}/${m}/${y}`, `${d}-${m}-${y}`, `${y}-${m}-${d}`,
    `${m}/${d}/${y}`, `${m}-${d}-${y}`,
  ].some((v) => text.includes(v));
}

async function extractOcrText(
  bytes: Buffer,
  mimeType: string,
): Promise<string | null> {
  const endpoint = process.env.TICKET_OCR_URL;
  if (!endpoint) return null;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mimeType,
        contentBase64: bytes.toString("base64"),
      }),
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("text" in payload) ||
      typeof (payload as { text?: unknown }).text !== "string"
    ) return null;

    return (payload as { text: string }).text.replace(/\s+/g, " ").trim().slice(0, 20000);
  } catch {
    return null;
  }
}

export function createTicketMetadataHash(bytes: Buffer, mimeType: string): string {
  return createHash("sha256").update(mimeType).update("\0").update(bytes).digest("hex");
}

export async function verifyTicket(
  input: TicketVerificationInput,
): Promise<TicketVerificationResult> {
  const metadataHash = createTicketMetadataHash(input.bytes, input.mimeType);
  const valid =
    input.bytes.length > 0 &&
    input.bytes.length <= MAX_TICKET_FILE_SIZE &&
    SUPPORTED_TICKET_TYPES.includes(
      input.mimeType as (typeof SUPPORTED_TICKET_TYPES)[number],
    ) &&
    hasMagicBytes(input.bytes, input.mimeType);

  if (!valid) {
    return {
      status: "FAILED",
      score: 0,
      reason: "File type, size, or file signature is invalid",
      ocrExtractedText: null,
      metadataHash,
      aiDetectionScore: null,
    };
  }

  const text = await extractOcrText(input.bytes, input.mimeType);
  const normalizedText = normalize(text ?? "");
  const destination = normalize(input.destination);
  const destinationMatch = text ? normalizedText.includes(destination) : null;
  const travelIndicator = /ticket|boarding|flight|train|bus|railway|airline|departure|arrival|travel/i.test(text ?? "");
  const passengerIndicator = /passenger|traveller|traveler|seat|coach|name/i.test(text ?? "");
  const bookingIndicator = /pnr|booking|reference|confirmation|reservation/i.test(text ?? "");
  const departureMatch = text ? dateMatches(text, input.departureDate) : null;

  let score = 0.35;
  if (destinationMatch === true) score += 0.20;
  if (departureMatch === true) score += 0.20;
  if (bookingIndicator) score += 0.10;
  if (travelIndicator) score += 0.10;
  if (passengerIndicator) score += 0.05;
  if (destinationMatch === false) score -= 0.20;
  if (departureMatch === false) score -= 0.20;
  score = Math.max(0, Math.min(1, Number(score.toFixed(4))));

  const status = score >= 0.8 ? "PASSED" : "SUSPICIOUS";
  const reason = [
    score >= 0.8 ? "strong verification signals" : "manual review recommended",
    !text ? "OCR text was unavailable" : null,
    destinationMatch === true ? "destination matched" : destinationMatch === false ? "destination did not match" : null,
    departureMatch === true ? "departure date matched" : departureMatch === false ? "departure date did not match" : null,
    bookingIndicator ? "booking/reference indicator found" : null,
    travelIndicator ? "travel-ticket indicator found" : null,
  ].filter(Boolean).join("; ");

  return {
    status,
    score,
    reason,
    ocrExtractedText: text,
    metadataHash,
    aiDetectionScore: null,
  };
}
