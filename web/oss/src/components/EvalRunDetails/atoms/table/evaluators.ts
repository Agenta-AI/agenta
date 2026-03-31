import {
    fetchWorkflow,
    fetchWorkflowRevisionById,
    extractEvaluatorRef,
    deduplicateRefs,
    toEvaluatorDefinitionFromWorkflow,
    toEvaluatorDefinitionFromRaw,
    type EvaluatorDefinition,
} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {effectiveProjectIdAtom} from "../run"

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
 * Self-contained query for fetching a workflow by ID.
 * Tries as revision ID first; if no data, falls back to artifact ID.
 * Defined locally to ensure it runs in the evaluations scoped store.
 */
const evaluatorRevisionQueryAtomFamily = atomFamily(
    ({projectId, id}: {projectId: string; id: string}) =>
        atomWithQuery(() => ({
            queryKey: ["eval-run", "evaluator-workflow", projectId, id],
            queryFn: async () => {
                try {
                    const revision = await fetchWorkflowRevisionById(id, projectId)
                    if (revision?.data) return revision
                    // No data — ID is likely an artifact ID, fetch latest revision
                    const artifactId = revision?.workflow_id ?? id
                    return await fetchWorkflow({id: artifactId, projectId})
                } catch {
                    try {
                        return await fetchWorkflow({id, projectId})
                    } catch {
                        return null
                    }
                }
            },
            enabled: !!projectId && !!id,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.projectId === b.projectId && a.id === b.id,
)

/**
 * Derived atom that resolves evaluator definitions for a given evaluation run.
 *
 * Uses self-contained queries that take projectId directly, bypassing the
 * shared projectIdAtom/sessionAtom which may not be populated in the
 * evaluations scoped store.
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

        const projectId = get(effectiveProjectIdAtom)

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

        // --- Resolve each ref via self-contained queries ---

        const definitions: EvaluatorDefinition[] = []
        let anyPending = false

        for (const ref of evaluatorRefs) {
            const refId = ref.revisionId ?? ref.artifactId
            if (!refId || !projectId) {
                continue
            }

            const query = get(evaluatorRevisionQueryAtomFamily({projectId, id: refId}))
            if (query.isPending || query.isFetching) {
                anyPending = true
                continue
            }

            const workflow = query.data
            if (workflow) {
                const definition = toEvaluatorDefinitionFromWorkflow(workflow)
                // Column lookups key by evaluator.id (artifact ID) from step
                // references. Override the definition ID to match. Also add
                // the revision ID so both lookup paths work.
                const lookupId = ref.artifactId ?? ref.revisionId ?? refId
                if (lookupId && definition.id !== lookupId) {
                    definition.id = lookupId
                }
                definitions.push(definition)
            } else if (!anyPending) {
                definitions.push({
                    id: refId,
                    name: ref.slug ?? refId,
                    slug: ref.slug,
                    description: null,
                    version: null,
                    metrics: [],
                })
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
