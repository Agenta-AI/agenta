/**
 * useScopeChangeEviction
 *
 * The exact cleanup snippet the production scenarios controller should
 * wire on (projectId, runId) change. Encapsulated as a hook so the test
 * page can validate it end-to-end and the next-PR production wiring can
 * just lift it.
 *
 * Triggers:
 *   - on dependency change (the *previous* scope's data gets evicted)
 *   - on unmount (component going away — release everything we wrote)
 *
 * What it evicts:
 *   - results + metrics → molecule.actions.evictByRunId (scoped to runId)
 *   - testcase + trace-entity + span → clearCacheByPrefix (run-agnostic)
 *
 * Atom families are intentionally NOT cleared here: in production, other
 * views (focus drawer, observability tab) may subscribe to the same
 * trace atoms. A `family.clear()` would yank their subscriptions too.
 * The PoC's headless harness clears them because there are no other
 * subscribers; the real controller should leave atoms alone.
 */

import {useEffect, useRef} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import {clearCacheByPrefix} from "@agenta/entities/evaluationRun/etl"

export interface UseScopeChangeEvictionArgs {
    projectId: string | null
    runId: string | null
}

export const useScopeChangeEviction = ({projectId, runId}: UseScopeChangeEvictionArgs): void => {
    // Track the previous (projectId, runId) so the cleanup function evicts
    // the *outgoing* scope, not the incoming one.
    const prevRef = useRef<{projectId: string | null; runId: string | null}>({
        projectId: null,
        runId: null,
    })

    useEffect(() => {
        prevRef.current = {projectId, runId}
        return () => {
            const {projectId: pp, runId: rr} = prevRef.current
            if (!pp || !rr) return
            try {
                evaluationResultMolecule.actions.evictByRunId({projectId: pp, runId: rr})
                evaluationMetricMolecule.actions.evictByRunId({projectId: pp, runId: rr})
                // testcase + trace caches aren't scoped by run. Production
                // wiring may want a more targeted invalidation (only the
                // testcase_ids / trace_ids for the outgoing run) once we
                // track which IDs were written for which scope.
                clearCacheByPrefix(["testcase", "trace-entity", "span"])
            } catch {
                // QueryClient may already be torn down on app close — swallow.
            }
        }
    }, [projectId, runId])
}
