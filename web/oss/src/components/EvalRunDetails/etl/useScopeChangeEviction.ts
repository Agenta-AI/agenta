/**
 * useScopeChangeEviction
 *
 * Evicts the molecule caches the ETL hydrate path wrote when the
 * (projectId, runId) scope changes or the table unmounts.
 *
 * Triggers:
 *   - on dependency change (the *previous* scope's data gets evicted)
 *   - on unmount (component going away — release everything we wrote)
 *
 * What it evicts:
 *   - results + metrics → molecule.actions.evictByRunId (scoped to runId)
 *   - testcase + trace-entity + span → clearCacheByPrefix (run-agnostic)
 *
 * Atom families are intentionally NOT cleared: other views (focus drawer,
 * observability tab) may subscribe to the same trace atoms. A
 * `family.clear()` would yank their subscriptions too.
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
                clearCacheByPrefix(["testcase", "trace-entity", "span"])
            } catch {
                // QueryClient may already be torn down on app close — swallow.
            }
        }
    }, [projectId, runId])
}
