import {describe, expect, it} from "vitest"

import {describeRunFailure} from "@/features/chat/RunErrorMessage"

describe("describeRunFailure for a model that needs setup", () => {
    it("uses the banner's words and offers no retry or recovery card", () => {
        const view = describeRunFailure({
            text: "The model needs setup before this agent can run.",
            code: "agent_needs_setup",
            onRetry: () => undefined,
            can: {providers: true, buyCredits: true, plans: true},
        })
        expect(view.paragraphs).toEqual(["The model needs setup before this agent can run."])
        expect(view.failure.label).toBe("This agent needs setup")
        expect(view.onRetry).toBeUndefined()
        expect(view.recoveries).toEqual([])
    })
})
