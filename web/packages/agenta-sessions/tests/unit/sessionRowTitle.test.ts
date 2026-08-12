import {describe, expect, it} from "vitest"

import {sessionRowTitle} from "../../src/row/sessionRowTitle"

describe("sessionRowTitle", () => {
    it("leads with the name when there is one", () => {
        expect(sessionRowTitle("approval-flow-test", "You: make me a file")).toEqual({
            title: "approval-flow-test",
            subtitle: "You: make me a file",
        })
    })

    it("names the automation when one fired the run", () => {
        expect(sessionRowTitle(null, "Digest sent.", "Nightly digest")).toEqual({
            title: "Nightly digest",
            subtitle: "Digest sent.",
        })
    })

    it("prefers a typed name over the automation's", () => {
        // Someone renamed the run; that beats the automation that started it.
        expect(
            sessionRowTitle("Investigating the spike", "Digest sent.", "Nightly digest"),
        ).toEqual({title: "Investigating the spike", subtitle: "Digest sent."})
    })

    it("leads with the message when nobody named the session", () => {
        // A run from before the trigger stamp existed, or a nameless manual session.
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
