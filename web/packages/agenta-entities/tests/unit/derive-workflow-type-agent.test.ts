/**
 * Unit tests for the `agent` arm of workflow-type derivation (WP-6).
 *
 * `deriveWorkflowTypeFromRevision` maps a revision to a single UI rendering
 * category. Agent is detected two ways, in priority order:
 *   1. URI kind — `provider:kind:agent:version` (the 3rd `:`-segment is the key).
 *   2. Flag fallback — `is_agent` wins over `is_custom`/`is_chat`, because an
 *      SDK-deployed agent currently surfaces as custom + is_chat for back-compat.
 *
 * These cases guard the disjointness the playground branch relies on: an agent
 * must never resolve to "chat" or "custom" once it carries the agent signal.
 */

import {describe, it, expect} from "vitest"

import {deriveWorkflowTypeFromRevision} from "../../src/workflow/state/helpers"

// Minimal revision shape — only the fields the function reads.
const rev = (over: {
    uri?: string
    slug?: string
    flags?: Record<string, boolean>
}) =>
    ({
        slug: over.slug,
        data: over.uri ? {uri: over.uri} : undefined,
        flags: over.flags ?? {},
    }) as any

describe("deriveWorkflowTypeFromRevision — agent", () => {
    it("resolves an agent URI kind to 'agent'", () => {
        // provider:kind:KEY:version → key segment === "agent"
        expect(deriveWorkflowTypeFromRevision(rev({uri: "agenta:serve:agent:v0.1"}))).toBe(
            "agent",
        )
    })

    it("resolves the is_agent flag to 'agent' when no URI kind matches", () => {
        expect(deriveWorkflowTypeFromRevision(rev({flags: {is_agent: true}}))).toBe("agent")
    })

    it("lets is_agent win over is_chat (back-compat flagging)", () => {
        expect(
            deriveWorkflowTypeFromRevision(rev({flags: {is_agent: true, is_chat: true}})),
        ).toBe("agent")
    })

    it("lets is_agent win over is_custom (agents currently surface as custom)", () => {
        expect(
            deriveWorkflowTypeFromRevision(rev({flags: {is_agent: true, is_custom: true}})),
        ).toBe("agent")
    })

    // Regression: the new agent arm must not perturb existing resolution.
    it("still resolves chat / custom / completion unchanged", () => {
        expect(deriveWorkflowTypeFromRevision(rev({flags: {is_chat: true}}))).toBe("chat")
        expect(deriveWorkflowTypeFromRevision(rev({flags: {is_custom: true}}))).toBe("custom")
        expect(deriveWorkflowTypeFromRevision(rev({}))).toBe("completion")
        expect(deriveWorkflowTypeFromRevision(rev({uri: "agenta:serve:chat:v0.1"}))).toBe(
            "chat",
        )
    })
})
