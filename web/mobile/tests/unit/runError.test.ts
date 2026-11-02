import {describe, expect, it} from "vitest"

import {
    describeRunError,
    formatRunError,
    humanizeNumbers,
    providerOf,
} from "@/features/chat/runError"

describe("describeRunError", () => {
    it("lifts the provider's sentence out of a status-prefixed JSON blob", () => {
        const text =
            '402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 64000 tokens, but can only afford 13044. To increase, visit https://openrouter.ai/x","code":402,"metadata":{"limit_source":"openrouter_credits"}}'
        const error = describeRunError(text)
        expect(error.status).toBe(402)
        expect(error.headline).toBe(
            "The model provider refused the request: not enough credits on the OpenRouter key.",
        )
        expect(error.remedy).toBe("Add credits or pick another model, then try again.")
        expect(error.raw).toBe(text)
    })

    it("reads a nested error message and keeps plain text as it is", () => {
        expect(describeRunError('{"error":{"message":"Model not found."}}').headline).toBe(
            "Model not found.",
        )
        const plain = describeRunError("The sandbox went away.")
        expect(plain.headline).toBe("The sandbox went away.")
        expect(plain.status).toBeUndefined()
        expect(plain.raw).toBeNull()
    })

    it("recognises a rejected key, a rate limit and an outage", () => {
        expect(describeRunError("401: Invalid API key").headline).toBe(
            "The model provider rejected the model key.",
        )
        expect(describeRunError("429: Too Many Requests").remedy).toBe(
            "Wait a moment, then try again.",
        )
        expect(describeRunError("503: overloaded").headline).toBe(
            "The model provider isn't responding.",
        )
        // The LLM gateway's own timeout.
        expect(
            describeRunError(
                '408: {"error":{"message":"The model provider did not answer in time.","code":"upstream_timeout"}}',
            ).headline,
        ).toBe("The model provider isn't responding.")
        // An unfamiliar failure keeps the provider's own sentence and offers no remedy.
        const other = describeRunError('400: {"message":"Unsupported parameter: tools."}')
        expect(other.headline).toBe("Unsupported parameter: tools.")
        expect(other.remedy).toBeUndefined()
        // The word alone is not the failure.
        expect(describeRunError('400: {"message":"Unknown field credits."}').remedy).toBeUndefined()
    })

    it("never shows an empty headline", () => {
        expect(describeRunError("   ").headline).toBe("Something went wrong.")
    })
})

describe("formatRunError", () => {
    it("keeps the whole runner sentence, with readable numbers and the remedy apart", () => {
        const text =
            "Agent output exceeded the turn limit (16777216 bytes or 50000 updates). The turn was stopped. Check the model or provider before retrying."
        const error = formatRunError(text)

        expect(error.paragraphs).toEqual([
            "Agent output exceeded the turn limit (16 MB or 50,000 updates). The turn was stopped.",
            "Check the model or provider before retrying.",
        ])
        expect(error.raw).toBe(text)
    })

    it("keeps a sentence that ends in 'here' when it never had a link", () => {
        expect(formatRunError("Model is not available here.").paragraphs).toEqual([
            "Model is not available here.",
        ])
    })

    it("keeps no raw text when the message only gained a period", () => {
        const error = formatRunError("Failed to fetch")

        expect(error.paragraphs).toEqual(["Failed to fetch."])
        expect(error.raw).toBeNull()
    })

    it("quotes the provider under our sentence, without the link sentence", () => {
        const error = formatRunError(
            '402: {"message":"This request requires more credits. You can only afford 13044. To increase, visit https://openrouter.ai/settings/credits","code":402}',
        )

        expect(error.kind).toBe("credits")
        expect(error.paragraphs[0]).toBe(
            "The model provider refused the request: not enough credits on the OpenRouter key.",
        )
        expect(error.quote).toBe("This request requires more credits. You can only afford 13,044.")
        expect(error.provider?.billingUrl).toBe("https://openrouter.ai/settings/credits")
    })

    it("reads a provider body a harness wrapped in its own words", () => {
        const error = formatRunError(
            'anthropic said 401: {"type":"error","error":{"message":"invalid x-api-key"}}',
        )

        expect(error.kind).toBe("key")
        expect(error.quote).toBe("invalid x-api-key.")
        expect(error.provider?.kind).toBe("anthropic")
    })

    it.each([
        ["429: You exceeded your current quota, please check your plan and billing details."],
        ["400: Your credit balance is too low to access the Anthropic API."],
    ])("reads %s as a credit failure", (text) => {
        expect(formatRunError(text).kind).toBe("credits")
    })

    it("cuts a stacktrace to its first sentence and keeps it whole for the fold", () => {
        const trace = `Runner crashed. ${"at frame (file.ts:1)\n".repeat(20)}`
        const error = formatRunError(trace)

        expect(error.paragraphs).toEqual(["Runner crashed."])
        expect(error.raw).toBe(trace.trim())
    })
})

describe("providerOf", () => {
    it("leaves a sentence's closing stop off the billing link", () => {
        expect(
            providerOf("Out of credits, top up at https://openrouter.ai/settings/credits.")
                ?.billingUrl,
        ).toBe("https://openrouter.ai/settings/credits")
    })

    it("prefers the provider's own billing link, never its docs link", () => {
        expect(
            providerOf("Quota exceeded. See https://platform.openai.com/docs/guides/error-codes")
                ?.billingUrl,
        ).toBe("https://platform.openai.com/settings/organization/billing/overview")
    })

    it("tells Vertex AI from Gemini by host", () => {
        expect(providerOf("https://aiplatform.googleapis.com/v1/x failed")?.kind).toBe("vertex_ai")
        expect(providerOf("https://generativelanguage.googleapis.com/v1 failed")?.kind).toBe(
            "gemini",
        )
    })

    it("does not read an OpenAI-compatible endpoint as OpenAI", () => {
        expect(providerOf("The OpenAI-compatible endpoint refused the request.")).toBeNull()
    })
})

describe("humanizeNumbers", () => {
    it("writes bytes in units and long numbers with separators, and leaves ids alone", () => {
        expect(humanizeNumbers("1048576 bytes and 64000 tokens, req_123456")).toBe(
            "1 MB and 64,000 tokens, req_123456",
        )
    })
})
