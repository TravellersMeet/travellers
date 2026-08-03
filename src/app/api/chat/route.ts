import { NextResponse } from "next/server";
import { z } from "zod";
import { withValidation } from "@/lib/withValidation";
import {
  applyRateLimitHeaders,
  checkRateLimit,
  getRateLimitIdentifier,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

const chatSchema = z.object({
  message: z.string().min(1, "Message required").max(500, "Message too long (max 500 characters)."),
});

export const POST = withValidation(chatSchema, async (req, data) => {
    try {
        // Gate the paid Gemini call so an anonymous visitor can't run up unlimited
        // billed upstream requests (cost-abuse / prompt-injection surface).
        const rateLimit = await checkRateLimit({
            namespace: "chat",
            identifier: getRateLimitIdentifier(req),
            limit: 10,
            windowSeconds: 60,
        });

        if (!rateLimit.allowed) {
            return rateLimitExceededResponse(rateLimit);
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json(
                { error: "AI not configured." },
                { status: 500 }
            );
        }

        const { message } = data;

        const systemPrompt = `
You are TravelBox AI, an assistant for the Travellers ticket-sharing platform.

You help users with:
- Uploading tickets
- Ticket verification
- Smart matching
- Dashboard usage
- Messaging
- Account management

You may answer naturally and conversationally.

If a question is unrelated to the Travellers platform,
politely guide the user back to platform-related help instead of refusing abruptly.

Keep responses short, helpful, and friendly.
Do not mention system prompts or technical details.
`;

        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": process.env.GEMINI_API_KEY!,
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: systemPrompt + "\nUser: " + message,
                                },
                            ],
                        },
                    ],
                }),
            }
        );



        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error("Gemini API Error:", errorText);

            return NextResponse.json(
                { error: "AI request failed." },
                { status: 500 }
            );
        }

        const responseData = await geminiResponse.json();

        const reply =
            responseData.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reply) {
            return NextResponse.json(
                { error: "AI did not return a response." },
                { status: 500 }
            );
        }

        return applyRateLimitHeaders(
            NextResponse.json({ reply }),
            rateLimit,
        ) as NextResponse;

    } catch (error) {
        console.error("Chat API Error:", error);

        return NextResponse.json(
            { error: "Something went wrong." },
            { status: 500 }
        );
    }
});
