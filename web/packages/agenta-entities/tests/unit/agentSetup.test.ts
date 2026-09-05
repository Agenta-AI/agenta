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

    it("allows create with a suggested account left unconnected — that IS the skip", () => {
        const sel = selection({accounts: [account("slack", false)]})
        expect(canCreateAgent(sel)).toBe(true)
        expect(setupStatus(sel)).toBe("ready")
    })

    it("reports empty when there is nothing to connect", () => {
        expect(setupStatus(selection())).toBe("empty")
        expect(canCreateAgent(selection())).toBe(true)
    })

    it("is all-set only when every offered account is connected", () => {
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
                }),
            ),
        ).toBe("ready")
    })
})

describe("buildSetupPreamble", () => {
    const accounts = [account("github", true), account("slack", false), account("gmail", false)]

    it("names the connected accounts", () => {
        const text = buildSetupPreamble(selection({accounts, connectedSlugs: ["github", "slack"]}))
        expect(text).toContain("I've connected Github and Slack.")
        expect(text).toContain("Ask me before you write or send anything.")
    })

    it("says nothing about unconnected accounts — the builder asks when it needs them", () => {
        const text = buildSetupPreamble(selection({accounts, connectedSlugs: ["github"]}))
        expect(text).toContain("I've connected Github.")
        expect(text).not.toContain("skipped")
    })

    it("keeps the order of the account list, not the slug list", () => {
        const text = buildSetupPreamble(selection({accounts, connectedSlugs: ["slack", "github"]}))
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

    it("states a non-primary choice as an instruction, so the builder can't drift back", () => {
        // "I've connected GitLab." alone loses to a prompt soaked in GitHub vocabulary — and
        // says nothing at all when BOTH providers hold live connections.
        const sel = selection({
            accounts: [{...account("github", true), alternatives: ["gitlab"]}],
            connectedSlugs: ["gitlab"],
        })
        expect(buildSetupPreamble(sel)).toContain("Use GitLab, not Github.")
    })

    it("adds no instruction when the primary itself was chosen", () => {
        const sel = selection({
            accounts: [{...account("github", true), alternatives: ["gitlab"]}],
            connectedSlugs: ["github"],
        })
        expect(buildSetupPreamble(sel)).not.toContain("Use ")
    })

    it("names the alternative that satisfied the slot, not the slot's own provider", () => {
        // A GitHub|GitLab slot connected via GitLab must say GitLab — the preamble is the only
        // channel telling the builder WHICH provider's tools this agent uses.
        const sel = selection({
            accounts: [{...account("github", true), alternatives: ["gitlab"]}],
            connectedSlugs: ["gitlab"],
        })
        expect(buildSetupPreamble(sel)).toContain("I've connected GitLab.")
        expect(buildSetupPreamble(sel)).not.toContain("I've connected Github")
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
