/**
 * Both onboarding flows end to end, at the level the rules live (#6043 item 6): a description or a
 * template goes in, and what comes out is the rows the step shows and whether Create is gated.
 *
 * The UI is covered separately (`@agenta/entity-ui` AgentSetupCard.gating). This suite exists so a
 * change to detection or gating cannot silently alter what either flow produces.
 */
import {describe, expect, it} from "vitest"

import {canCreateAgent, setupStatus} from "../../src/workflow/agentSetup"
import {templateConnections, type AgentStarterTemplate} from "../../src/workflow/agentTemplates"
import {FIXTURE_TEMPLATES as AGENT_TEMPLATES} from "./agentTemplateFixtures"
import {detectAccounts} from "../../src/workflow/detectAccounts"

/** Everything the step does between the user's input and `createAgent`. */
const runStep = ({
    description,
    template,
    connect = [],
}: {
    description?: string
    template?: AgentStarterTemplate
    connect?: string[]
}) => {
    const accounts = detectAccounts({description, template})
    const selection = {
        accounts,
        connectedSlugs: connect,
    }
    return {
        accounts,
        slugs: accounts.map((a) => a.slug),
        canCreate: canCreateAgent(selection),
        status: setupStatus(selection),
    }
}

describe("free-text onboarding", () => {
    const description = "Triage new GitHub issues and post a daily digest to Slack"

    it("offers the accounts named in the description, in that order", () => {
        expect(runStep({description}).slugs).toEqual(["github", "slack"])
    })

    it("never blocks create, however the user leaves the step", () => {
        expect(runStep({description}).canCreate).toBe(true)
        expect(runStep({description, connect: ["github"]}).canCreate).toBe(true)
    })

    it("detects nothing from a description that names no service", () => {
        const result = runStep({description: "An agent that writes release notes"})
        expect(result.slugs).toEqual([])
        expect(result.status).toBe("empty")
        expect(result.canCreate).toBe(true)
    })
})

describe("template onboarding", () => {
    const template = AGENT_TEMPLATES.find(
        (entry) => templateConnections(entry).length > 0,
    ) as AgentStarterTemplate
    // The primary option of each slot — what detection offers, and so what gating sees.
    const declared = templateConnections(template).map((slot) => slot.primary.slug)

    it("blocks create until every declared integration is connected", () => {
        expect(runStep({template}).canCreate).toBe(false)
        expect(runStep({template}).status).toBe("blocked")
        expect(runStep({template, connect: declared}).canCreate).toBe(true)
    })

    it("connecting only some of them still blocks", () => {
        if (declared.length < 2) return
        expect(runStep({template, connect: [declared[0]]}).canCreate).toBe(false)
    })

    it("merges the template's accounts with ones named in the builder message", () => {
        const {slugs} = runStep({
            description: "Build this, and also post to Slack",
            template,
        })
        expect(slugs.slice(0, declared.length)).toEqual(declared)
        if (!declared.includes("slack")) expect(slugs).toContain("slack")
    })
})
