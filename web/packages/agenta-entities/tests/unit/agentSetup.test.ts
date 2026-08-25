import {describe, expect, it} from "vitest"

import {
    DEFAULT_PERMISSION,
    appendSetupPreamble,
    buildSetupPreamble,
    canCreateAgent,
    outstandingRequired,
    setupStatus,
    type AgentSetupSelection,
} from "../../src/workflow/agentSetup"
import type {DetectedAccount} from "../../src/workflow/detectAccounts"

const account = (slug: string, required: boolean): DetectedAccount => ({
    slug,
    label: slug === "googlecalendar" ? "Google Calendar" : slug[0].toUpperCase() + slug.slice(1),
    why: "does a thing",
    origin: required ? "template" : "text",
    required,
})

const selection = (over: Partial<AgentSetupSelection> = {}): AgentSetupSelection => ({
    accounts: [],
    connectedSlugs: [],
    skippedSlugs: [],
    permission: DEFAULT_PERMISSION,
    ...over,
})

describe("gating", () => {
    it("blocks create while a required account is unconnected", () => {
        const sel = selection({accounts: [account("github", true)]})
        expect(canCreateAgent(sel)).toBe(false)
        expect(outstandingRequired(sel).map((a) => a.slug)).toEqual(["github"])
        expect(setupStatus(sel)).toBe("blocked")
    })

    it("allows create once every required account is connected", () => {
        const sel = selection({accounts: [account("github", true)], connectedSlugs: ["github"]})
        expect(canCreateAgent(sel)).toBe(true)
        expect(setupStatus(sel)).toBe("all-set")
    })

    it("never blocks on a text-detected account, connected or not", () => {
        const sel = selection({accounts: [account("slack", false), account("github", false)]})
        expect(canCreateAgent(sel)).toBe(true)
        expect(outstandingRequired(sel)).toEqual([])
        expect(setupStatus(sel)).toBe("ready")
    })

    it("allows create with every suggested account skipped", () => {
        const sel = selection({
            accounts: [account("slack", false)],
            skippedSlugs: ["slack"],
        })
        expect(canCreateAgent(sel)).toBe(true)
        expect(setupStatus(sel)).toBe("ready")
    })

    it("reports empty when there is nothing to connect", () => {
        expect(setupStatus(selection())).toBe("empty")
        expect(canCreateAgent(selection())).toBe(true)
    })

    it("is all-set only when nothing is unresolved and nothing was skipped", () => {
        expect(
            setupStatus(
                selection({
                    accounts: [account("github", true), account("slack", false)],
                    connectedSlugs: ["github", "slack"],
                }),
            ),
        ).toBe("all-set")
        expect(
            setupStatus(
                selection({
                    accounts: [account("github", true), account("slack", false)],
                    connectedSlugs: ["github"],
                    skippedSlugs: ["slack"],
                }),
            ),
        ).toBe("ready")
    })
})

describe("buildSetupPreamble", () => {
    const accounts = [account("github", true), account("slack", false), account("gmail", false)]

    it("names the connected accounts", () => {
        const text = buildSetupPreamble(
            selection({accounts, connectedSlugs: ["github", "slack"]}),
        )
        expect(text).toContain("I've connected Github and Slack.")
        expect(text).toContain("Ask me before you write or send anything.")
    })

    it("names the skipped ones so the agent doesn't immediately re-ask", () => {
        const text = buildSetupPreamble(
            selection({accounts, connectedSlugs: ["github"], skippedSlugs: ["gmail"]}),
        )
        expect(text).toContain("I've connected Github.")
        expect(text).toContain("I've skipped Gmail for now — ask me when you need it.")
    })

    it("keeps the order of the account list, not the slug list", () => {
        const text = buildSetupPreamble(
            selection({accounts, connectedSlugs: ["slack", "github"]}),
        )
        expect(text).toContain("I've connected Github and Slack.")
    })

    it("says nothing when no account was resolved and the permission is the default", () => {
        expect(buildSetupPreamble(selection({accounts}))).toBe("")
    })

    it("still sends a non-default permission with no accounts at all", () => {
        expect(buildSetupPreamble(selection({permission: "read"}))).toBe(
            "Don't write or send anything — read only.",
        )
        expect(buildSetupPreamble(selection({permission: "auto"}))).toContain(
            "You can act without asking me for approval.",
        )
    })

    it("ignores a connected slug that is not on the card", () => {
        expect(buildSetupPreamble(selection({accounts, connectedSlugs: ["notion"]}))).toBe("")
    })
})

describe("appendSetupPreamble", () => {
    const accounts = [account("slack", false)]

    it("appends the preamble below the seed", () => {
        const seed = "Build an agent that posts a digest."
        const out = appendSetupPreamble(seed, selection({accounts, connectedSlugs: ["slack"]}))
        expect(out.startsWith(seed)).toBe(true)
        expect(out).toContain("\n\nI've connected Slack.")
    })

    it("leaves the seed untouched when there is nothing to add", () => {
        const seed = "Build an agent that writes poems."
        expect(appendSetupPreamble(seed, selection())).toBe(seed)
    })

    it("returns the preamble alone for an empty seed", () => {
        const out = appendSetupPreamble("  ", selection({accounts, connectedSlugs: ["slack"]}))
        expect(out.startsWith("I've connected Slack.")).toBe(true)
    })
})
