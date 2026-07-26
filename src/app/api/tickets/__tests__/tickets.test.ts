import { describe, it, expect, beforeEach, vi } from "vitest"
import prisma from "@/lib/prisma"
import { POST } from "../route"
import { auth } from "@/lib/auth"

vi.mock("@/lib/prisma", () => ({
    default: {
        user: {
            findFirst: vi.fn(),
        },
        ticket: {
            create: vi.fn(),
        },
    },
}))

vi.mock("@/lib/auth", () => ({
    auth: vi.fn(),
}))

vi.mock("@/lib/cloudinary-upload", () => ({
    uploadFileToCloudinary: vi.fn(() => Promise.resolve({ url: "about:blank" })),
}))

class MockFile extends Blob {
    name: string
    lastModified: number
    constructor(chunks: any[], name: string, opts?: BlobPropertyBag) {
        super(chunks, opts)
        this.name = name
        this.lastModified = Date.now()
    }
}
const dummyFile = new MockFile(["dummy"], "ticket.pdf", {
    type: "application/pdf",
}) as File

interface MockNextRequest {
    headers: {
        get: (name: string) => string | null
    }
    formData: () => Promise<FormData>
}

function makeNextRequest(form: FormData): MockNextRequest {
    return {
        headers: {
            get: (name: string) => {
                if (name.toLowerCase() === "content-type") {
                    return "multipart/form-data";
                }
                return null;
            }
        },
        formData: async () => form,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
        ; (auth as any).mockResolvedValue({ user: { id: "user1" } })
})

describe("POST /api/tickets", () => {
    it("returns 400 if destination is missing", async () => {
        const body = new FormData()
        body.append("departureDate", "2025-12-31")
        body.append("file", dummyFile)

        const res = await POST(makeNextRequest(body) as any)
        const data = await res.json()

        expect(res.status).toBe(400)
        expect(data.error).toBe("Invalid input")
    })

    it("returns 400 if file is missing", async () => {
        const body = new FormData()
        body.append("destination", "Paris")
        body.append("departureDate", "2025-12-31")

        const res = await POST(makeNextRequest(body) as any)
        const data = await res.json()

        expect(res.status).toBe(400)
        expect(data.error).toBe("Invalid input")
    })

    it("returns 400 if departureDate is invalid", async () => {
        const body = new FormData()
        body.append("destination", "Paris")
        body.append("departureDate", "not-a-date")
        body.append("file", dummyFile)

        const res = await POST(makeNextRequest(body) as any)
        const data = await res.json()

        expect(res.status).toBe(400)
        expect(data.error).toBe("Invalid input")
    })

    it("returns 401 if unauthorized", async () => {
        ; (auth as any).mockResolvedValue(null)

        const body = new FormData()
        body.append("destination", "Paris")
        body.append("departureDate", "2025-12-31")
        body.append("file", dummyFile)

        const res = await POST(makeNextRequest(body) as any)
        const data = await res.json()

        expect(res.status).toBe(401)
        expect(data.error).toBe("Unauthorized")
    })

    it("returns 200 and creates ticket if valid input and user exists", async () => {
        ; (auth as any).mockResolvedValue({ user: { id: "user1" } })
            ; (prisma.ticket.create as any).mockResolvedValue({
                id: "ticket1",
                userId: "user1",
                destination: "Paris",
                departureDate: new Date("2025-12-31"),
                ticketUrl: "about:blank",
                status: "PENDING",
            })

        const body = new FormData()
        body.append("destination", "Paris")
        body.append("departureDate", "2025-12-31")
        body.append("file", dummyFile)

        const res = await POST(makeNextRequest(body) as any)
        const data = await res.json()

        expect(res.status).toBe(200)
        expect(data.ok).toBe(true)
        expect(prisma.ticket.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userId: "user1",
                    destination: "Paris",
                    status: "PENDING",
                }),
            }),
        )
    })
})