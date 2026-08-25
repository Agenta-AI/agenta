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
    it("names the single account that blocks create", () => {
        expect(setupFootnote("blocked", [account("github", true)], 0)).toBe(
            "Connect Github to create.",
        )
    })

    it("names both when two block", () => {
        expect(
            setupFootnote("blocked", [account("github", true), account("slack", true)], 0),
        ).toBe("Connect Github and Slack to create.")
    })

    it("counts them past two", () => {
        const three = ["github", "slack", "gmail"].map((s) => account(s, true))
        expect(setupFootnote("blocked", three, 0)).toBe("Connect 3 accounts to create.")
    })

    it("does not claim there is nothing to do while accounts are still offered", () => {
        const line = setupFootnote("ready", [], 0)
        expect(line).toBe("Connect these now, or the agent will ask later.")
        expect(line).not.toContain("Nothing")
    })

    it("explains what skipping costs", () => {
        expect(setupFootnote("ready", [], 1)).toBe("Skipped accounts are asked for later.")
    })

    it("says nothing is required when nothing was detected", () => {
        expect(setupFootnote("empty", [], 0)).toBe("Nothing required.")
    })

    it("is quiet once everything is connected", () => {
        expect(setupFootnote("all-set", [], 0)).toBe("Nothing to do here.")
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
        expect(setupBadge("blocked", 1, 0)).toEqual({text: "Required", tone: "warning"})
    })

    it("reports the skip count over the found count", () => {
        expect(setupBadge("ready", 2, 1)).toEqual({text: "1 skipped", tone: "neutral"})
    })

    it("reports what was found when nothing is skipped", () => {
        expect(setupBadge("ready", 2, 0)).toEqual({text: "2 found", tone: "neutral"})
    })

    it("has nothing to say on an empty card", () => {
        expect(setupBadge("empty", 0, 0)).toBeNull()
    })
})
