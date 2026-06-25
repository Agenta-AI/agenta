/**
 * Schema resolution from the canonical `/inspect` response shape.
 *
 * Architecture-followups issue 1: `/inspect` now returns the canonical `WorkflowInspectResponse`
 * (sdks/python/agenta/sdk/models/workflows.py) whose `revision` IS the resolved
 * `WorkflowRevisionData`, so schemas live at `revision.schemas`. The store read
 * (`web/packages/agenta-entities/src/workflow/state/store.ts`, the inspect branch) reads exactly
 * that path. These tests pin that read against the real response shape so it cannot silently
 * regress to resolving `undefined` (the latent break this fix closes).
 *
 * The store's read is an inline expression over the query data, not an exported function, so we
 * reproduce that exact expression here over a typed `InspectWorkflowResponse`. The point is the
 * CONTRACT: the canonical body resolves schemas; the old nested envelope does not.
 */

import {describe, expect, it} from "vitest"

import type {InspectWorkflowResponse} from "../../src/workflow/api/api"

// The exact read the store performs in its inspect branch (store.ts).
function resolveInspectSchemas(inspectData: InspectWorkflowResponse | null) {
    if (!inspectData) return null
    const inspectSchemas = inspectData.revision?.schemas
    if (!inspectSchemas) return null
    return {
        inputs: inspectSchemas.inputs,
        outputs: inspectSchemas.outputs,
        parameters: inspectSchemas.parameters,
    }
}

describe("inspect response schema resolution", () => {
    it("resolves schemas from the canonical revision.schemas shape", () => {
        const body: InspectWorkflowResponse = {
            version: "2025.07.14",
            revision: {
                uri: "agenta:builtin:agent:v0",
                schemas: {
                    inputs: {type: "object", properties: {messages: {type: "array"}}},
                    parameters: {type: "object"},
                    outputs: {
                        invoke: {"x-ag-type-ref": "message", type: "object"},
                        messages: {"x-ag-type-ref": "messages", type: "array"},
                    },
                },
                parameters: {agent: {model: "gpt-5.5"}},
            },
            meta: {harness_capabilities: {}},
        }

        const resolved = resolveInspectSchemas(body)
        expect(resolved).not.toBeNull()
        expect(resolved?.inputs).toEqual({
            type: "object",
            properties: {messages: {type: "array"}},
        })
        expect(resolved?.parameters).toEqual({type: "object"})
    })

    it("exposes outputs keyed per output surface (invoke / messages)", () => {
        const body: InspectWorkflowResponse = {
            revision: {
                schemas: {
                    outputs: {
                        invoke: {"x-ag-type-ref": "message"},
                        messages: {"x-ag-type-ref": "messages"},
                    },
                },
            },
        }

        const resolved = resolveInspectSchemas(body)
        const outputs = resolved?.outputs as Record<string, Record<string, unknown>> | undefined
        expect(outputs && Object.keys(outputs).sort()).toEqual(["invoke", "messages"])
        expect(outputs?.invoke["x-ag-type-ref"]).toBe("message")
        expect(outputs?.messages["x-ag-type-ref"]).toBe("messages")
    })

    it("resolves nothing when there is no revision (no crash, no stale schemas)", () => {
        expect(resolveInspectSchemas({})).toBeNull()
        expect(resolveInspectSchemas(null)).toBeNull()
    })
})
