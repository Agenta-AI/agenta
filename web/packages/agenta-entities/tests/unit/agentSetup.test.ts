import {describe, expect, it} from "vitest"

import {
    canCreateAgent,
    outstandingRequired,
    setupStatus,
    setupStepNeeded,
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

describe("setupStepNeeded", () => {
    it("skips the step when nothing was detected", () => {
        expect(setupStepNeeded({...selection(), forTemplate: true})).toBe(false)
    })

    it("asks while a required account is unconnected", () => {
        const accounts = [account("github", true)]
        expect(setupStepNeeded({...selection({accounts}), forTemplate: true})).toBe(true)
        expect(
            setupStepNeeded({
                ...selection({accounts, connectedSlugs: ["github"]}),
                forTemplate: true,
            }),
        ).toBe(false)
    })

    it("still asks a template whose satisfied slot offers another provider", () => {
        const accounts = [{...account("github", true), alternatives: ["gitlab"]}]
        const connected = selection({accounts, connectedSlugs: ["github"]})
        expect(setupStepNeeded({...connected, forTemplate: true})).toBe(true)
        expect(setupStepNeeded({...connected, forTemplate: false})).toBe(false)
    })
})
