/**
 * A `workflow-changed` event names one workflow. Re-reading every agent's latest revision for it
 * cost one request per cached agent, so the id narrows the keys whose data names a workflow.
 */
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it} from "vitest"

import {
    invalidateAgentCommittedRevisionCache,
    revalidateAgentRevisionReads,
} from "../../src/workflow/state/store"

const seeded: [unknown[], unknown][] = [
    [["workflows", "latestRevision", "A", "p"], {id: "a1", workflow_id: "A"}],
    [["workflows", "latestRevision", "B", "p"], {id: "b1", workflow_id: "B"}],
    [["workflows", "latestRevision", "C", "p"], null],
    [
        ["workflows", "latestRevision", "mobile", "p", "variant-of-A"],
        {revisionId: "a1", workflowId: "A"},
    ],
    [["workflows", "latestRevision", "mobile", "p", "B"], {revisionId: "b1", workflowId: "B"}],
    [["workflows", "revisionsByWorkflow", "A", "p"], {count: 1, refs: [{id: "a1"}]}],
    [["workflows", "revisionsByWorkflow", "B", "p"], {count: 1, refs: [{id: "b1"}]}],
    [["workflows", "revisions", "variant-of-B", "p"], {count: 1, refs: [{id: "b1"}]}],
    [["workflows", "inspect", "agenta:builtin:agent", "svc", "p"], {}],
    [["workflows", "apps", "agentFlags", "p"], []],
    [["workflows", "revision", "b1", "p"], {id: "b1", workflow_id: "B"}],
]

let queryClient: QueryClient

const invalidatedKeys = () =>
    queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.isInvalidated)
        .map((query) => query.queryKey.join("/"))
        .sort()

beforeEach(() => {
    queryClient = new QueryClient()
    getDefaultStore().set(queryClientAtom, queryClient)
    for (const [key, data] of seeded) queryClient.setQueryData(key, data)
})

describe("invalidateAgentCommittedRevisionCache", () => {
    it("with a workflow id, re-reads only that workflow's latest revision", () => {
        invalidateAgentCommittedRevisionCache("A")

        expect(invalidatedKeys()).toEqual([
            "workflows/apps/agentFlags/p",
            "workflows/inspect/agenta:builtin:agent/svc/p",
            "workflows/latestRevision/A/p",
            "workflows/latestRevision/mobile/p/variant-of-A",
            "workflows/revisions/variant-of-B/p",
            "workflows/revisionsByWorkflow/A/p",
            "workflows/revisionsByWorkflow/B/p",
        ])
    })

    it("re-reads a latest-revision key that holds no revision yet by its key", () => {
        invalidateAgentCommittedRevisionCache("C")

        expect(invalidatedKeys()).toContain("workflows/latestRevision/C/p")
        expect(invalidatedKeys()).not.toContain("workflows/latestRevision/A/p")
    })

    it("re-reads a host key that names the workflow by its bound id and holds no data yet", () => {
        queryClient.setQueryData(["workflows", "latestRevision", "mobile", "p", "D"], null)

        invalidateAgentCommittedRevisionCache("D")

        expect(invalidatedKeys()).toEqual([
            "workflows/apps/agentFlags/p",
            "workflows/inspect/agenta:builtin:agent/svc/p",
            "workflows/latestRevision/mobile/p/D",
            "workflows/revisions/variant-of-B/p",
            "workflows/revisionsByWorkflow/A/p",
            "workflows/revisionsByWorkflow/B/p",
        ])
    })

    it("without an id, re-reads every latest revision", () => {
        invalidateAgentCommittedRevisionCache()

        expect(invalidatedKeys()).toEqual([
            "workflows/apps/agentFlags/p",
            "workflows/inspect/agenta:builtin:agent/svc/p",
            "workflows/latestRevision/A/p",
            "workflows/latestRevision/B/p",
            "workflows/latestRevision/C/p",
            "workflows/latestRevision/mobile/p/B",
            "workflows/latestRevision/mobile/p/variant-of-A",
            "workflows/revisions/variant-of-B/p",
            "workflows/revisionsByWorkflow/A/p",
            "workflows/revisionsByWorkflow/B/p",
        ])
    })
})

describe("revalidateAgentRevisionReads", () => {
    it("re-reads the revisions a commit would, and leaves the agent/prompt split cached", () => {
        revalidateAgentRevisionReads("A")

        expect(invalidatedKeys()).toEqual([
            "workflows/inspect/agenta:builtin:agent/svc/p",
            "workflows/latestRevision/A/p",
            "workflows/latestRevision/mobile/p/variant-of-A",
            "workflows/revisions/variant-of-B/p",
            "workflows/revisionsByWorkflow/A/p",
            "workflows/revisionsByWorkflow/B/p",
        ])
    })
})
