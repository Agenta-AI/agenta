import {describe, expect, it} from "vitest"

import {describeRunError} from "@/features/chat/runError"

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
