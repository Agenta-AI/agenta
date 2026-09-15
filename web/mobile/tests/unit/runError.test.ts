import {describe, expect, it} from "vitest"

import {describeRunError} from "@/features/chat/runError"

describe("describeRunError", () => {
    it("lifts the provider's sentence out of a status-prefixed JSON blob", () => {
        const text =
            '402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 64000 tokens, but can only afford 13044. To increase, visit https://openrouter.ai/x","code":402,"metadata":{"limit_source":"openrouter_credits"}}'
        const error = describeRunError(text)
        expect(error.status).toBe(402)
        expect(error.headline).toBe("This request requires more credits, or fewer max_tokens.")
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

    it("never shows an empty headline", () => {
        expect(describeRunError("   ").headline).toBe("Something went wrong.")
    })
})
