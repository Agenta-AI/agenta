import {describe, expect, it} from "vitest"

import type {Workflow} from "../../src/workflow/core"
import {withLatestAgentFlags} from "../../src/workflow/state/helpers"

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
})
