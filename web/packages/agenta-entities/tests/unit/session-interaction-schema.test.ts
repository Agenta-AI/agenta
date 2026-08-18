/**
 * Pins the interaction row's `data.parameters` — the gated turn's stamped effective config.
 * zod objects strip unknown keys by default, so an undeclared field validates fine and
 * arrives as `undefined`: the resume would silently fall back to reference hydration and run
 * the committed config (wrong model, wrong tool permissions) with tsc and tests all green.
 * These assert the field survives parsing, and that legacy rows without it still parse.
 */
import {describe, expect, it} from "vitest"

import {
    sessionInteractionSchema,
    sessionInteractionsResponseSchema,
} from "../../src/session/core/schema"

const effectiveParameters = {
    agent: {
        llm: {model: "anthropic/claude-sonnet-4-5", provider: "anthropic"},
        runner: {kind: "sidecar", permissions: {default: "allow_reads"}},
    },
}

const wireInteraction = {
    id: "int-1",
    session_id: "sess-1",
    turn_id: "turn-1",
    token: "tok-1",
    kind: "user_approval",
    status: "pending",
    created_at: "2026-07-29T00:00:00Z",
    data: {
        request: {tool: "Bash", args: {command: "echo hi"}},
        references: {workflow: {id: "wf-1", slug: "agent"}},
        parameters: effectiveParameters,
    },
}

describe("sessionInteractionSchema", () => {
    it("keeps data.parameters (the stamped effective config) verbatim", () => {
        const out = sessionInteractionSchema.parse(wireInteraction)
        expect(out.data?.parameters).toEqual(effectiveParameters)
    })

    it("keeps request and references alongside parameters", () => {
        const out = sessionInteractionSchema.parse(wireInteraction)
        expect(out.data?.references).toEqual({workflow: {id: "wf-1", slug: "agent"}})
        expect(out.data?.request).toEqual({tool: "Bash", args: {command: "echo hi"}})
    })

    it("parses a legacy row that carries no parameters (pre-stamping runner)", () => {
        const legacy = {
            ...wireInteraction,
            data: {references: {workflow: {id: "wf-1"}}},
        }
        const out = sessionInteractionSchema.parse(legacy)
        expect(out.data?.parameters).toBeUndefined()
        expect(out.data?.references).toEqual({workflow: {id: "wf-1"}})
    })

    it("carries parameters through the query response envelope", () => {
        const out = sessionInteractionsResponseSchema.parse({
            count: 1,
            interactions: [wireInteraction],
        })
        expect(out.interactions?.[0].data?.parameters).toEqual(effectiveParameters)
    })
})
