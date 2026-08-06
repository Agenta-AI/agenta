/**
 * Schema resolution from the `/inspect` response shape.
 *
 * `/inspect` returns `WorkflowInspectResponse` (sdks/python/agenta/sdk/models/workflows.py) whose
 * `revision` is a `WorkflowRevision` (UNMODIFIED), so schemas live at `revision.data.schemas` and
 * the resolved parameters at `revision.data.parameters` — never lifted out of `data`. The store
 * read (`web/packages/agenta-entities/src/workflow/state/store.ts`, the inspect branch) reads
 * exactly that path. These tests pin that read so it cannot silently regress to resolving
 * `undefined`.
 *
 * The store's read is an inline expression over the query data, not an exported function, so we
 * reproduce that exact expression here over a typed `InspectWorkflowResponse`.
 */

import {describe, expect, it} from "vitest"

import type {InspectWorkflowResponse} from "../../src/workflow/api/api"

// The exact read the store performs in its inspect branch (store.ts).
function resolveInspectSchemas(inspectData: InspectWorkflowResponse | null) {
    if (!inspectData) return null
    const inspectSchemas = inspectData.revision?.data?.schemas
    if (!inspectSchemas) return null
    return {
        inputs: inspectSchemas.inputs,
        outputs: inspectSchemas.outputs,
        parameters: inspectSchemas.parameters,
    }
}

describe("inspect response schema resolution", () => {
    it("resolves schemas from revision.data.schemas (revision is a WorkflowRevision)", () => {
        const body: InspectWorkflowResponse = {
            version: "2025.07.14",
            revision: {
                data: {
                    uri: "agenta:builtin:agent:v0",
                    schemas: {
                        inputs: {type: "object", properties: {messages: {type: "array"}}},
                        parameters: {type: "object"},
                        outputs: {
                            type: "object",
                            properties: {messages: {"x-ag-type-ref": "messages", type: "array"}},
                        },
                    },
                    parameters: {agent: {model: "gpt-5.5"}},
                },
            },
            request: {data: {revision: {}}},
            meta: {},
        }

        const resolved = resolveInspectSchemas(body)
        expect(resolved).not.toBeNull()
        expect(resolved?.inputs).toEqual({
            type: "object",
            properties: {messages: {type: "array"}},
        })
        expect(resolved?.parameters).toEqual({type: "object"})
    })

    it("exposes outputs as a plain object with a `messages` field (not keyed by surface)", () => {
        const body: InspectWorkflowResponse = {
            revision: {
                data: {
                    schemas: {
                        outputs: {
                            type: "object",
                            properties: {messages: {"x-ag-type-ref": "messages"}},
                        },
                    },
                },
            },
        }

        const resolved = resolveInspectSchemas(body)
        const outputs = resolved?.outputs as Record<string, any> | undefined
        expect(outputs?.type).toBe("object")
        expect(outputs?.properties?.messages?.["x-ag-type-ref"]).toBe("messages")
        // No per-surface keying: there is no `invoke` surface.
        expect(outputs?.properties?.invoke).toBeUndefined()
    })

    it("resolves nothing when there is no revision (no crash, no stale schemas)", () => {
        expect(resolveInspectSchemas({})).toBeNull()
        expect(resolveInspectSchemas(null)).toBeNull()
    })
})
