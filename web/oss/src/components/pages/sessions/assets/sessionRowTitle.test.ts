import {describe, expect, it} from "vitest"

import {sessionRowTitle} from "./sessionRowTitle"

describe("sessionRowTitle", () => {
    it("leads with the name when there is one", () => {
        expect(sessionRowTitle("approval-flow-test", "You: make me a file")).toEqual({
            title: "approval-flow-test",
            subtitle: "You: make me a file",
        })
    })

    it("leads with the message when nobody named the session", () => {
        // The automation-run case: no human was there to type a name.
        expect(sessionRowTitle(null, "Ran the nightly digest.")).toEqual({
            title: "Ran the nightly digest.",
            subtitle: null,
        })
    })

    it("does not print the message twice", () => {
        expect(sessionRowTitle("   ", "Hello!").subtitle).toBeNull()
    })

    it("falls back only when there is nothing to say", () => {
        expect(sessionRowTitle(null, null)).toEqual({title: "Untitled session", subtitle: null})
    })
})
