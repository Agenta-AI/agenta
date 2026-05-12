import {fetchWorkflowsBatch} from "@agenta/entities/workflow"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {buildRunIndex} from "@/oss/lib/evaluations/buildRunIndex"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {
    getPreviewRunBatcher,
    invalidatePreviewRunCache,
} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"

import {TERMINAL_STATUSES} from "../compare"
import {effectiveProjectIdAtom} from "../run"

import type {EvaluationRun} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/types"

export interface EvaluationRunQueryResult {
    rawRun: EvaluationRun
    camelRun: any
    runIndex: ReturnType<typeof buildRunIndex>
}

const isTerminalStatus = (status: string | null | undefined) => {
    if (!status) return false
    return TERMINAL_STATUSES.has(status.toLowerCase())
}

const patchedRunRevisionSet = new Set<string>()
const resolvedEvaluatorRefsByRunKey = new Map<
    string,
    Map<string, {evaluator_revision: any; evaluator_variant?: any}>
>()

const normalizeRefValue = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

type EnsureEvaluatorRevisionsReason =
    | "already-patched-in-session"
    | "no-steps"
    | "no-missing-revisions"
    | "no-step-updates"
    | "patched"

interface EnsureEvaluatorRevisionsResult {
    run: EvaluationRun
    patched: boolean
    reason: EnsureEvaluatorRevisionsReason
}

const applyResolvedEvaluatorRefs = ({
    runKey,
    rawRun,
}: {
    runKey: string
    rawRun: EvaluationRun
}): EvaluationRun => {
    const refsByStepKey = resolvedEvaluatorRefsByRunKey.get(runKey)
    if (!refsByStepKey || refsByStepKey.size === 0) return rawRun

    const steps = Array.isArray(rawRun?.data?.steps) ? rawRun.data.steps : []
    if (!steps.length) return rawRun

    let changed = false
    const mergedSteps = steps.map((step: any) => {
        if (!step || step.type !== "annotation" || typeof step.key !== "string") {
            return step
        }

        const cached = refsByStepKey.get(step.key)
        if (!cached) return step

        const references = step.references ?? {}
        const nextReferences = {
            ...references,
            evaluator_revision: {
                ...(references.evaluator_revision ?? {}),
                ...(cached.evaluator_revision ?? {}),
            },
            ...(cached.evaluator_variant
                ? {
                      evaluator_variant: {
                          ...(references.evaluator_variant ?? {}),
                          ...(cached.evaluator_variant ?? {}),
                      },
                  }
                : {}),
        }

        if (
            references.evaluator_revision !== nextReferences.evaluator_revision ||
            (cached.evaluator_variant &&
                references.evaluator_variant !== nextReferences.evaluator_variant)
        ) {
            changed = true
        }

        return {
            ...step,
            references: nextReferences,
        }
    })

    if (!changed) return rawRun
    return {
        ...rawRun,
        data: {
            ...(rawRun?.data ?? {}),
            steps: mergedSteps,
        },
    }
}

/**
 * Ensures each annotation step in a run has `evaluator_revision` refs resolved.
 *
 * The backend strips `evaluator_revision` and `evaluator_variant` from run responses
 * (see `_unresolve_run_response`). This function resolves them client-side using
 * `fetchWorkflowsBatch` — a single batch request that fetches latest revisions
 * for all evaluator workflow IDs referenced in the run.
 */
const ensureEvaluatorRevisions = async ({
    runId,
    projectId,
    rawRun,
}: {
    runId: string
    projectId: string
    rawRun: EvaluationRun
}): Promise<EnsureEvaluatorRevisionsResult> => {
    const runKey = `${projectId}:${runId}`

    if (patchedRunRevisionSet.has(runKey)) {
        const normalizedRun = applyResolvedEvaluatorRefs({runKey, rawRun})
        return {run: normalizedRun, patched: false, reason: "already-patched-in-session"}
    }

    const steps = Array.isArray(rawRun?.data?.steps) ? rawRun.data.steps : []
    if (!steps.length) {
        patchedRunRevisionSet.add(runKey)
        return {run: rawRun, patched: false, reason: "no-steps"}
    }

    // Find steps that have evaluator artifact refs but no resolved revision refs
    const revisionCandidates = steps
        .map((step: any, index: number) => ({step, index}))
        .filter(({step}) =>
            Boolean(
                step &&
                step.type === "annotation" &&
                step.references &&
                step.references.evaluator &&
                !step.references.evaluator_revision,
            ),
        )

    if (!revisionCandidates.length) {
        patchedRunRevisionSet.add(runKey)
        return {run: rawRun, patched: false, reason: "no-missing-revisions"}
    }

    // Collect unique evaluator workflow IDs to resolve
    const evaluatorIdsByStepKey = new Map<string, string>()
    for (const {step} of revisionCandidates) {
        const evaluatorRef = step.references.evaluator ?? step.references.evaluator_ref ?? null
        const evaluatorId = normalizeRefValue(evaluatorRef?.id)
        if (evaluatorId && step.key) {
            evaluatorIdsByStepKey.set(step.key, evaluatorId)
        }
    }

    const uniqueEvaluatorIds = [...new Set(evaluatorIdsByStepKey.values())]
    if (uniqueEvaluatorIds.length === 0) {
        patchedRunRevisionSet.add(runKey)
        return {run: rawRun, patched: false, reason: "no-missing-revisions"}
    }

    // Single batch request to resolve all evaluator workflows → latest revisions
    let resolvedMap: Map<string, {id: string; slug?: string; version?: number; variant_id?: string}>

    try {
        const workflowMap = await fetchWorkflowsBatch(projectId, uniqueEvaluatorIds)
        resolvedMap = new Map()
        for (const [workflowId, workflow] of workflowMap) {
            resolvedMap.set(workflowId, {
                id: workflow.id,
                slug: workflow.slug ?? undefined,
                version: workflow.version ?? undefined,
                variant_id: workflow.workflow_variant_id ?? workflow.variant_id ?? undefined,
            })
        }
    } catch (error) {
        console.warn("[ensureEvaluatorRevisions] Failed to batch-fetch evaluator revisions", {
            runId,
            error,
        })
        patchedRunRevisionSet.add(runKey)
        return {run: rawRun, patched: false, reason: "no-step-updates"}
    }

    // Patch steps with resolved revision refs
    const updatedSteps = [...steps]

    for (const {step, index} of revisionCandidates) {
        const evaluatorId = evaluatorIdsByStepKey.get(step.key)
        if (!evaluatorId) continue

        const resolved = resolvedMap.get(evaluatorId)
        if (!resolved?.id) continue

        const nextReferences = {
            ...step.references,
            evaluator_revision: {
                ...(step.references.evaluator_revision ?? {}),
                id: resolved.id,
                slug: resolved.slug,
                version: resolved.version != null ? String(resolved.version) : undefined,
            },
            ...(resolved.variant_id
                ? {
                      evaluator_variant: {
                          ...(step.references.evaluator_variant ?? {}),
                          id: resolved.variant_id,
                      },
                  }
                : {}),
        }

        updatedSteps[index] = {
            ...step,
            references: nextReferences,
        }
    }

    const didUpdate = updatedSteps.some((step: any, i: number) => step !== steps[i])

    if (!didUpdate) {
        patchedRunRevisionSet.add(runKey)
        return {run: rawRun, patched: false, reason: "no-step-updates"}
    }

    const patchedRun: EvaluationRun = {
        ...rawRun,
        data: {
            ...(rawRun?.data ?? {}),
            steps: updatedSteps,
        },
    }

    try {
        if (process.env.NODE_ENV !== "production") {
            console.debug("[EvalRunDetails2] Patching run with evaluator revisions", {
                runId,
                projectId,
                patchedRun,
            })
        }
        await axios.patch(`/evaluations/runs/${encodeURIComponent(runId)}`, {run: patchedRun}, {
            params: {project_id: projectId},
            _ignoreError: true,
        } as any)
        if (process.env.NODE_ENV !== "production") {
            console.debug("[EvalRunDetails2] Run patch successful", {
                runId,
                projectId,
            })
        }
        if (process.env.NODE_ENV !== "production") {
            console.debug(
                "[EvalRunDetails2] Metrics refresh would trigger after patch but is disabled",
                {
                    runId,
                    projectId,
                },
            )
        }

        patchedRunRevisionSet.add(runId)
        return {run: patchedRun, patched: true}
    } catch (error) {
        console.warn("[EvalRunDetails2] Failed to patch run with evaluator revisions", {
            runId,
            error,
        })
        return {run: rawRun, patched: false}
    }

    patchedRunRevisionSet.add(runKey)
    return {run: patchedRun, patched: true, reason: "patched"}
}

export const evaluationRunQueryAtomFamily = atomFamily((runId: string | null) =>
    atomWithQuery<EvaluationRunQueryResult>((get) => {
        const projectId = get(effectiveProjectIdAtom)

        return {
            queryKey: ["preview", "evaluation-run", runId, projectId],
            enabled: Boolean(runId && projectId),
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchInterval: (query) => {
                const status =
                    query.state.data?.rawRun?.status ?? query.state.data?.camelRun?.status
                return isTerminalStatus(status) ? false : 5000
            },
            queryFn: async () => {
                if (!runId) {
                    throw new Error("evaluationRunQueryAtomFamily requires a run id")
                }
                if (!projectId) {
                    throw new Error("evaluationRunQueryAtomFamily requires a project id")
                }

                invalidatePreviewRunCache(projectId, runId)
                const batcher = getPreviewRunBatcher()
                const rawRun = await batcher({projectId, runId})
                if (!rawRun) {
                    throw new Error(
                        `Preview evaluation run payload missing for run ${runId} (project ${projectId})`,
                    )
                }

                const {run: normalizedRun} = await ensureEvaluatorRevisions({
                    runId,
                    projectId,
                    rawRun,
                })

                const camelRun = snakeToCamelCaseKeys(normalizedRun)
                const runIndex = buildRunIndex(camelRun)
                return {rawRun, camelRun, runIndex}
            },
        }
    }),
)

/**
 * Atom family that accepts both runId and projectId as parameters.
 * This is useful when the global projectIdAtom may not be set yet (e.g., in a new browser window).
 */
export const evaluationRunWithProjectQueryAtomFamily = atomFamily(
    ({runId, projectId}: {runId: string | null; projectId: string | null}) =>
        atomWithQuery<EvaluationRunQueryResult>(() => {
            return {
                queryKey: ["preview", "evaluation-run", runId, projectId],
                enabled: Boolean(runId && projectId),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!runId) {
                        throw new Error("evaluationRunWithProjectQueryAtomFamily requires a run id")
                    }
                    if (!projectId) {
                        throw new Error(
                            "evaluationRunWithProjectQueryAtomFamily requires a project id",
                        )
                    }

                    const batcher = getPreviewRunBatcher()
                    const rawRun = await batcher({projectId, runId})
                    if (!rawRun) {
                        throw new Error(
                            `Preview evaluation run payload missing for run ${runId} (project ${projectId})`,
                        )
                    }

                    const {run: normalizedRun} = await ensureEvaluatorRevisions({
                        runId,
                        projectId,
                        rawRun,
                    })

                    const camelRun = snakeToCamelCaseKeys(normalizedRun)
                    const runIndex = buildRunIndex(camelRun)
                    return {rawRun, camelRun, runIndex}
                },
            }
        }),
    (a, b) => a.runId === b.runId && a.projectId === b.projectId,
)

export const evaluationRunIndexAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query) => query.data?.runIndex ?? null,
        (a, b) => a === b,
    ),
)
