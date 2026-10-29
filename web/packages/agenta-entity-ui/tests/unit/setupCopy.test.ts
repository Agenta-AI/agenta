/**
 * The setup card's footnote states the consequence of pressing Create right now, so each state
 * has to say something true. Live QA on /m caught the one that didn't: two unconnected accounts
 * with Connect buttons on screen, and a footnote reading "Nothing to do here."
 */
import type {DetectedAccount} from "@agenta/entities/workflow"
import {describe, expect, it} from "vitest"

import {setupBadge, setupFootnote, setupLead, setupTitle} from "../../src/onboarding/copy"

const account = (slug: string, required: boolean): DetectedAccount => ({
    slug,
    label: slug[0].toUpperCase() + slug.slice(1),
    why: "does a thing",
    origin: required ? "template" : "text",
    required,
})

describe("setupFootnote", () => {
    // Blocked says NOTHING: the header badge and the amber Required rows say it already, and
    // the disabled Create button says what it costs — a footnote would be the third telling.
    it("stays silent while blocked", () => {
        expect(setupFootnote("blocked")).toBe("")
    })

    it("does not claim there is nothing to do while accounts are still offered", () => {
        const line = setupFootnote("ready")
        expect(line).toBe("Connect these now, or the agent will ask later.")
        expect(line).not.toContain("Nothing")
    })

    it("says nothing is required when nothing was detected", () => {
        expect(setupFootnote("empty")).toBe("Nothing required.")
    })

    it("is quiet once everything is connected", () => {
        expect(setupFootnote("all-set")).toBe("")
    })
})

describe("setupTitle / setupLead", () => {
    it("asks rather than instructs when nothing was detected", () => {
        expect(setupTitle("empty")).toBe("Any accounts to connect?")
        expect(setupLead("empty")).toContain("didn't spot")
    })

    it("names the outcome when everything is connected", () => {
        expect(setupTitle("all-set")).toBe("Ready to build")
    })

    it("always offers the skip route in the lead", () => {
        expect(setupLead("ready")).toContain("skip")
    })

    it("does not claim a template's declared accounts came from your description", () => {
        const lead = setupLead("blocked", true)
        expect(lead).not.toContain("your description")
        expect(lead).toContain("This template needs these accounts")
    })

    it("names the description as the source when there is no template", () => {
        expect(setupLead("ready", false)).toContain("From your description")
    })
})

describe("setupBadge", () => {
    it("flags a required account as the thing to deal with", () => {
        expect(setupBadge("blocked", 1)).toEqual({text: "Required", tone: "warning"})
    })

    it("reports what was found while nothing gates", () => {
        expect(setupBadge("ready", 2)).toEqual({text: "2 found", tone: "neutral"})
    })

    it("has nothing to say on an empty card", () => {
        expect(setupBadge("empty", 0)).toBeNull()
    })
})
