// @vitest-environment jsdom
import {QueryClient} from "@tanstack/react-query"
import {atom, createStore} from "jotai"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {evaluatorReferenceAtomFamily, evaluatorWorkflowQueryAtomFamily} from "./entityReferences"

/**
 * Drives the real `/evaluations` code path in a jotai store and MEASURES how many query
 * atoms one subscribed evaluator column creates. The sibling file asserts the rule; this
 * one asserts the observable consequence.
 *
 * `evaluatorReferenceAtomFamily` reads `evaluatorWorkflowQueryAtomFamily` from inside its
 * own read function with a key it rebuilds on every read. Without an `areEqual` on the inner
 * family, each read mints a new query atom, the new atom mounts its own observer, the
 * observer emits, and the emit invalidates the reader that created it.
 *
 * Measured trajectory over 200 ticks with the comparator removed: 1, 2, 2, 2, 2 — it settles
 * at two, because this query has a 5 minute `staleTime` and neither polls nor refetches on
 * focus, so generation two reads settled cached data and emits nothing further. So the bug
 * this guards is a duplicated atom and a duplicated fetch, NOT the runaway that produced
 * React error #185 on the run-details page (that family polled while a run was non-terminal,
 * which is what compounded). Adding a `refetchInterval` here would turn this into that bug.
 *
 * One subscription must create exactly ONE query atom.
 */

// The entities package reaches the network and pulls in a large module graph. Only the
// handful of bindings `entityReferences` actually uses are stubbed here; the workflow query
// resolves immediately so the loop, if present, runs at full speed instead of waiting on IO.
vi.mock("@agenta/entities/workflow", () => ({
    fetchWorkflow: vi.fn(async () => ({id: "wf1", workflow_id: "wf1", slug: "evaluator-slug"})),
    fetchWorkflowRevisionById: vi.fn(async () => ({
        id: "rev1",
        workflow_id: "wf1",
        slug: "evaluator-slug",
        data: {uri: "agenta://workflow/evaluator", service: {}},
    })),
    parseWorkflowKeyFromUri: () => "evaluator",
    resolveOutputSchemaProperties: () => ({score: {type: "number", title: "Score"}}),
    workflowMolecule: {selectors: {query: () => atom({data: null, isPending: false})}},
    workflowsListQueryStateAtom: atom({data: [] as unknown[], isPending: false}),
    workflowArtifactScopedQueryAtomFamily: atomFamily(
        (_key: {projectId: string; workflowId: string}) => atom({data: {name: "Evaluator"}}),
        (a, b) => a.projectId === b.projectId && a.workflowId === b.workflowId,
    ),
}))

vi.mock("@agenta/entities/environment", () => ({
    appEnvironmentsQueryAtomFamily: atomFamily((_k: unknown) => atom({data: []})),
}))

vi.mock("@agenta/entities/testset", () => ({
    testsetQueryAtomFamily: atomFamily((_k: unknown) => atom({data: null, isPending: false})),
}))

const flush = async (ticks: number) => {
    for (let i = 0; i < ticks; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

describe("evaluatorReferenceAtomFamily does not mint an atom per read", () => {
    let store: ReturnType<typeof createStore>
    let unsub: (() => void) | undefined

    beforeEach(() => {
        store = createStore()
        store.set(
            queryClientAtom,
            new QueryClient({
                defaultOptions: {queries: {retry: false, gcTime: Infinity, staleTime: Infinity}},
            }),
        )
    })

    afterEach(() => {
        unsub?.()
        unsub = undefined
    })

    it("creates exactly one workflow query atom for one subscribed evaluator column", async () => {
        // What `MetricColumnHeader` -> `useEvaluatorHeaderReference` mounts: one evaluator
        // column, resolved by id, which is the branch that reads the inner query family.
        const referenceAtom = evaluatorReferenceAtomFamily({projectId: "p1", id: "rev1"})
        unsub = store.sub(referenceAtom, () => {
            // Reading inside the subscriber is what the React binding does, and it is what
            // re-enters the read function once the query emits.
            store.get(referenceAtom)
        })
        store.get(referenceAtom)

        await flush(50)

        const minted = [...evaluatorWorkflowQueryAtomFamily.getParams()].length
        expect(minted).toBe(1)
    })
})
