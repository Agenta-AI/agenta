import {
    workflowMolecule,
    workflowLatestRevisionQueryAtomFamily,
    extractEvaluatorRef,
    deduplicateRefs,
    toEvaluatorDefinitionFromWorkflow,
    toEvaluatorDefinitionFromRaw,
    type EvaluatorDefinition,
} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {evaluationRunQueryAtomFamily} from "./run"

/** Result shape matching TanStack Query atom interface for backward compatibility */
interface EvaluatorQueryResult {
    data: EvaluatorDefinition[]
    isPending: boolean
    isFetching: boolean
    isError: boolean
    error: null
}

/**
 * Derived atom that resolves evaluator definitions for a given evaluation run
 * by reading from the workflow entity system (molecule).
 *
 * For each evaluator referenced in the run:
 * - If a revision ID is available, reads via workflowMolecule.atoms.query (exact revision)
 * - Otherwise falls back to workflowLatestRevisionQueryAtomFamily (artifact ID → latest)
 * - Last resort: slug lookup via the workflows list
 *
 * The entity system handles batching and caching automatically.
 */
export const evaluationEvaluatorsByRunQueryAtomFamily = atomFamily((runId: string | null) =>
    atom<EvaluatorQueryResult>((get) => {
        if (!runId) {
            return {data: [], isPending: false, isFetching: false, isError: false, error: null}
        }

        const runQuery = get(evaluationRunQueryAtomFamily(runId))

        if (!runQuery?.data) {
            return {data: [], isPending: true, isFetching: true, isError: false, error: null}
        }

        // --- Extract evaluator refs from run data ---

        const refsFromIndex = Object.values(runQuery.data.runIndex.steps ?? {})
            .map((step: any) => extractEvaluatorRef(step?.refs ?? {}))
            .filter((ref) => ref.artifactId || ref.revisionId || ref.slug)

        const rawSteps =
            (runQuery.data.camelRun as any)?.data?.steps ??
            (runQuery.data.rawRun as any)?.data?.steps ??
            []
        const refsFromRawSteps = Array.isArray(rawSteps)
            ? rawSteps
                  .map((step: any) => extractEvaluatorRef(step?.references ?? {}))
                  .filter((ref) => ref.artifactId || ref.revisionId || ref.slug)
            : []

        const evaluatorRefs = deduplicateRefs([...refsFromIndex, ...refsFromRawSteps])

        // --- Check for embedded evaluators (inline in run data) ---

        const embeddedEvaluators = ((runQuery.data.camelRun as any)?.data?.evaluators ??
            (runQuery.data.rawRun as any)?.data?.evaluators ??
            []) as any[]

        if (Array.isArray(embeddedEvaluators) && embeddedEvaluators.length > 0) {
            return {
                data: embeddedEvaluators.map(toEvaluatorDefinitionFromRaw),
                isPending: false,
                isFetching: false,
                isError: false,
                error: null,
            }
        }

        if (evaluatorRefs.length === 0) {
            return {data: [], isPending: false, isFetching: false, isError: false, error: null}
        }

        // --- Resolve each ref via the workflow entity system ---

        // Read workflows list for slug-based fallback resolution
        const allWorkflows = get(workflowMolecule.atoms.listData)

        const definitions: EvaluatorDefinition[] = []
        let anyPending = false

        for (const ref of evaluatorRefs) {
            let workflow = null

            if (ref.revisionId) {
                // Best path: exact revision ID
                const revisionQuery = get(workflowMolecule.atoms.query(ref.revisionId))
                if (revisionQuery.isPending) {
                    anyPending = true
                    continue
                }
                workflow = revisionQuery.data ?? null
            }

            if (!workflow && ref.artifactId) {
                // Next: artifact ID → latest revision
                const latestQuery = get(workflowLatestRevisionQueryAtomFamily(ref.artifactId))
                if (latestQuery.isPending) {
                    anyPending = true
                    continue
                }
                workflow = latestQuery.data ?? null
            }

            if (!workflow && ref.artifactId) {
                // Try entity atom (may already be hydrated from list queries)
                workflow = get(workflowMolecule.atoms.entity(ref.artifactId))
            }

            if (!workflow && ref.slug) {
                // Last resort: slug lookup from loaded workflows list
                workflow = allWorkflows.find((w) => w.slug === ref.slug) ?? null
            }

            if (workflow) {
                definitions.push(toEvaluatorDefinitionFromWorkflow(workflow))
            }
        }

        return {
            data: definitions,
            isPending: anyPending && definitions.length === 0,
            isFetching: anyPending,
            isError: false,
            error: null,
        }
    }),
)
