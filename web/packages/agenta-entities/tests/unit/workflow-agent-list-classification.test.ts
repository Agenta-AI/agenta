import {describe, expect, it} from "vitest"

import type {Workflow} from "../../src/workflow/core"
import {
    selectAgentWorkflows,
    selectNonAgentWorkflows,
    withAgentFlags,
} from "../../src/workflow/state/helpers"

const workflow = (id: string, isAgent: boolean): Workflow =>
    ({
        id,
        flags: {is_agent: isAgent},
    }) as Workflow

describe("agent flags map", () => {
    const artifacts = [
        workflow("prompt-1", false),
        workflow("agent-1", false),
        workflow("unresolved-1", false),
    ]
    const agentFlags = new Map([
        ["prompt-1", false],
        ["agent-1", true],
    ])

    it("keeps only workflows the map marks as agents", () => {
        expect(selectAgentWorkflows(artifacts, agentFlags).map(({id}) => id)).toEqual(["agent-1"])
    })

    it("treats a workflow absent from the map as a prompt, not an agent", () => {
        // Pins the "unresolved" rule across the refactor: a missing entry must never promote a
        // workflow into the Agents group.
        expect(selectNonAgentWorkflows(artifacts, agentFlags).map(({id}) => id)).toEqual([
            "prompt-1",
            "unresolved-1",
        ])
    })

    it("stamps is_agent onto every workflow, resolved or not", () => {
        expect(
            withAgentFlags(artifacts, agentFlags).map(({id, flags}) => [id, flags?.is_agent]),
        ).toEqual([
            ["prompt-1", false],
            ["agent-1", true],
            ["unresolved-1", false],
        ])
    })
})
