import {describe, expect, it} from "vitest"

import type {Workflow} from "../../src/workflow/core"
import {
    filterAgentWorkflows,
    filterNonAgentWorkflows,
    withLatestAgentFlags,
} from "../../src/workflow/state/helpers"

const workflow = (id: string, isAgent: boolean): Workflow =>
    ({
        id,
        flags: {is_agent: isAgent},
    }) as Workflow

describe("withLatestAgentFlags", () => {
    it("uses revision-level agent flags when artifact rows omit the role", () => {
        const artifacts = [workflow("prompt-1", false), workflow("agent-1", false)]
        const latestRevisions = new Map([
            ["prompt-1", workflow("prompt-rev-1", false)],
            ["agent-1", workflow("agent-rev-1", true)],
        ])

        const classified = withLatestAgentFlags(artifacts, latestRevisions)

        expect(classified.map(({id, flags}) => [id, flags?.is_agent])).toEqual([
            ["prompt-1", false],
            ["agent-1", true],
        ])
    })

    it("keeps only workflows whose latest revision is an agent", () => {
        const artifacts = [
            workflow("completion-1", false),
            workflow("chat-1", false),
            workflow("custom-1", false),
            workflow("agent-1", false),
            workflow("unresolved-1", false),
        ]
        const latestRevisions = new Map([
            ["completion-1", workflow("completion-rev-1", false)],
            ["chat-1", workflow("chat-rev-1", false)],
            ["custom-1", workflow("custom-rev-1", false)],
            ["agent-1", workflow("agent-rev-1", true)],
        ])

        expect(filterAgentWorkflows(artifacts, latestRevisions).map(({id}) => id)).toEqual([
            "agent-1",
        ])
    })

    it("excludes agents from prompts while retaining unresolved workflows", () => {
        const artifacts = [
            workflow("prompt-1", false),
            workflow("agent-1", false),
            workflow("unresolved-1", false),
        ]
        const latestRevisions = new Map([
            ["prompt-1", workflow("prompt-rev-1", false)],
            ["agent-1", workflow("agent-rev-1", true)],
        ])

        expect(filterNonAgentWorkflows(artifacts, latestRevisions).map(({id}) => id)).toEqual([
            "prompt-1",
            "unresolved-1",
        ])
    })
})
