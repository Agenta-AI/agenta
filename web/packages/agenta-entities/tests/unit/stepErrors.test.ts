import {describe, expect, it} from "vitest"

import {extractStepError} from "../../src/shared/execution/stepErrors"

describe("extractStepError", () => {
    it.each(["failure", "failed", "error", "errors"])(
        "returns a displayable error for %s steps",
        (status) => {
            const result = extractStepError({
                status,
                error: {message: "OpenAI API key is missing"},
            })

            expect(result?.message).toBe("OpenAI API key is missing")
            expect(result?.raw).toEqual({message: "OpenAI API key is missing"})
        },
    )

    it("falls back to common non-message fields", () => {
        expect(
            extractStepError({
                status: "error",
                error: {detail: "Invalid provider configuration"},
            })?.message,
        ).toBe("Invalid provider configuration")
    })

    it("does not treat non-failed steps with error-shaped metadata as step errors", () => {
        expect(
            extractStepError({
                status: "success",
                error: {message: "not terminal"},
            }),
        ).toBeNull()
    })

    it("normalizes status casing", () => {
        expect(extractStepError({status: "ERROR", error: {message: "boom"}})?.message).toBe("boom")
    })

    it("returns null for terminal status without an error payload", () => {
        expect(extractStepError({status: "failed"})).toBeNull()
    })
})
