import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"

/**
 * evaluationRunFamily
 * --------------------
 * A single entry in the family represents **all atoms that must be scoped to a specific
 * evaluation run (identified by runId)**.
 *
 * Rationale
 * =========
 * The original implementation relied on a custom jotai store keyed by runId.  That
 * approach caused eager-import ordering issues (TDZ on globals) and does not scale to
 * multiple concurrent runs.  By moving to an `atomFamily` we keep everything inside
 * the default Jotai store and let React’s normal provider tree control lifecycles.
 *
 * NOTE:  At this first step we only expose the low-level atoms that already existed
 * globally.  The logic (bulk prefetch write-functions etc.) will be migrated in
 * follow-up commits.
 */

export const evaluationRunFamily = atomFamily((runId: string) => {
    /*
     * Bulk steps fetch / cache state – previously global in bulkFetch.ts
     */
    const bulkStepsStatusAtom = atom<"idle" | "loading" | "done" | "error">("idle")
    const bulkStepsRequestedAtom = atom(false)
    const bulkStepsCacheAtom = atom<Map<string, UseEvaluationRunScenarioStepsFetcherResult>>(
        new Map(),
    )
    const bulkStartedAtom = atom(false) // guard so init fires once per run

    const bundle = {
        runId,
        bulkStepsStatusAtom,
        bulkStepsRequestedAtom,
        bulkStepsCacheAtom,
        bulkStartedAtom,
    }

    // Return a constant atom whose value is the bundle. This satisfies the
    // atomFamily <Atom<Value>> signature while still giving easy access to the
    // nested atoms.
    return atom(bundle)
})

export type EvaluationRunAtoms = ReturnType<typeof evaluationRunFamily>
