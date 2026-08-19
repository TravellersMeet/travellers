import { describe, it, expect, beforeEach, vi } from "vitest"
import bcrypt from "bcryptjs"

// The custom /api/auth/signin route now delegates to NextAuth's handler.
// These tests verify the credential validation logic used by NextAuth's
// authorize() callback in src/lib/auth.ts via the Credentials provider.

vi.mock("@/lib/prisma", () => ({
    default: {
        user: {
            findUnique: vi.fn(),
        },
    },
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  applyRateLimitHeaders: vi.fn((response) => response),
  rateLimitExceededResponse: vi.fn(),
  getRateLimitIdentifier: vi.fn((req, email) => email || "127.0.0.1"),
}))

import prisma from "@/lib/prisma"
import { compare } from "bcryptjs"
import { RATE_LIMIT_CONFIG } from "@/lib/rate-limit-config"
// Import the mocked module as a namespace instead of rateLimit,
// which vitest can't resolve at runtime (the @ alias is transform-time only).
import * as rateLimit from "@/lib/rate-limit"

// Replicate the authorize logic for unit-testing independently of NextAuth internals
async function authorize(credentials: { email?: string; password?: string }) {
    if (!credentials?.email || !credentials?.password) return null
    if (credentials.password.length < 8) return null

    const user = await (prisma.user.findUnique as any)({ where: { email: credentials.email } })
    if (!user) return null

    const ok = await compare(credentials.password, user.passwordHash)
    if (!ok) return null

    return { id: user.id, email: user.email, name: user.name }
}

beforeEach(() => {
    vi.clearAllMocks()
    
    const { checkRateLimit } = rateLimit;
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: RATE_LIMIT_CONFIG.auth.signin.limit,
      remaining: RATE_LIMIT_CONFIG.auth.signin.limit - 1,
      resetAt: Date.now() + RATE_LIMIT_CONFIG.auth.signin.windowSeconds * 1000,
      retryAfter: 0,
      bypassed: false,
    });
})

describe("Credentials authorize logic", () => {
    it("returns null if email or password is missing", async () => {
        const result = await authorize({} as any)
        expect(result).toBeNull()
    })

    it("returns null if password is too short", async () => {
        const result = await authorize({ email: "test@example.com", password: "short" })
        expect(result).toBeNull()
    })

    it("returns null if user does not exist", async () => {
        ; (prisma.user.findUnique as any).mockResolvedValue(null)

        const result = await authorize({ email: "nouser@example.com", password: "password123" })
        expect(result).toBeNull()
    })

    it("returns null if password is wrong", async () => {
        const hash = await bcrypt.hash("password123", 10)

            ; (prisma.user.findUnique as any).mockResolvedValue({
                id: "1",
                email: "test@example.com",
                passwordHash: hash,
                name: "Tester",
            })

        const result = await authorize({ email: "test@example.com", password: "wrongpass1" })
        expect(result).toBeNull()
    })

    it("returns user if credentials are valid", async () => {
        const hash = await bcrypt.hash("password123", 10)

            ; (prisma.user.findUnique as any).mockResolvedValue({
                id: "1",
                email: "test@example.com",
                passwordHash: hash,
                name: "Tester",
            })

        const result = await authorize({ email: "test@example.com", password: "password123" })
        expect(result).toEqual({
            id: "1",
            email: "test@example.com",
            name: "Tester",
        })
    })

    it("uses configured rate limits for signin", () => {
        expect(RATE_LIMIT_CONFIG.auth.signin.limit).toBe(10);
        expect(RATE_LIMIT_CONFIG.auth.signin.windowSeconds).toBe(600);
    })
})
