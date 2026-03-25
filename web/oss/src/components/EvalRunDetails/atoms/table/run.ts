import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
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
const loggedAlreadyPatchedSkipSet = new Set<string>()
const resolvedEvaluatorRefsByRunKey = new Map<
    string,
    Map<string, {evaluator_revision: any; evaluator_variant?: any}>
>()
const resolvedEvaluatorByRefCache = new Map<
    string,
    {evaluator_revision: any; evaluator_variant?: any} | null
>()
const shouldLogEvaluatorRevisionDebug =
    process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true" || process.env.NODE_ENV !== "production"

const logEvaluatorRevisionDebug = (message: string, payload: Record<string, any>) => {
    if (!shouldLogEvaluatorRevisionDebug) return
    console.debug(message, payload)
}

const normalizeRefValue = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

const buildEvaluatorRefCacheKey = ({
    projectId,
    evaluatorRef,
}: {
    projectId: string
    evaluatorRef: Record<string, any>
}): string => {
    const id = normalizeRefValue(evaluatorRef.id) ?? ""
    const slug = normalizeRefValue(evaluatorRef.slug) ?? ""
    const version = normalizeRefValue(evaluatorRef.version) ?? ""
    return `${projectId}:${id}:${slug}:${version}`
}

const buildRevisionPayload = (references: Record<string, any> | undefined) => {
    if (!references) return null
    const evaluatorRef = references.evaluator ?? references.evaluator_ref ?? null
    if (!evaluatorRef) return null
    const payload: Record<string, any> = {}
    if (evaluatorRef.id || evaluatorRef.slug || evaluatorRef.version) {
        payload.evaluator_ref = {
            id: evaluatorRef.id,
            slug: evaluatorRef.slug,
            version: evaluatorRef.version,
        }
    }
    const evaluatorVariantRef = references.evaluator_variant ?? references.evaluatorVariant
    if (evaluatorVariantRef) {
        payload.evaluator_variant_ref = {
            id: evaluatorVariantRef.id,
            slug: evaluatorVariantRef.slug,
            version: evaluatorVariantRef.version,
        }
    }
    const evaluatorRevisionRef =
        references.evaluator_revision ?? references.evaluatorRevision ?? null
    if (evaluatorRevisionRef) {
        payload.evaluator_revision_ref = {
            id: evaluatorRevisionRef.id,
            slug: evaluatorRevisionRef.slug,
            version: evaluatorRevisionRef.version,
        }
    }
    return Object.keys(payload).length ? payload : null
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

const ensureEvaluatorRevisions = async ({
    runId,
    projectId,
    rawRun,
    source,
}: {
    runId: string
    projectId: string
    rawRun: EvaluationRun
    source: "evaluationRunQueryAtomFamily" | "evaluationRunWithProjectQueryAtomFamily"
}): Promise<EnsureEvaluatorRevisionsResult> => {
    const runKey = `${projectId}:${runId}`

    if (patchedRunRevisionSet.has(runKey)) {
        const skipLogKey = `${source}:${runKey}`
        if (!loggedAlreadyPatchedSkipSet.has(skipLogKey)) {
            loggedAlreadyPatchedSkipSet.add(skipLogKey)
            logEvaluatorRevisionDebug("[EvalRunDetails2] ensureEvaluatorRevisions skipped", {
                runId,
                projectId,
                source,
                reason: "already-patched-in-session",
            })
        }
        const normalizedRun = applyResolvedEvaluatorRefs({runKey, rawRun})
        return {
            run: normalizedRun,
            patched: false,
            reason: "already-patched-in-session",
        }
    }

    logEvaluatorRevisionDebug("[EvalRunDetails2] ensureEvaluatorRevisions started", {
        runId,
        projectId,
        source,
        alreadyPatchedInSession: false,
    })

    const steps = Array.isArray(rawRun?.data?.steps) ? rawRun.data.steps : []
    if (!steps.length) {
        logEvaluatorRevisionDebug("[EvalRunDetails2] ensureEvaluatorRevisions skipped", {
            runId,
            projectId,
            source,
            reason: "no-steps",
        })
        patchedRunRevisionSet.add(runKey)
        return {run: rawRun, patched: false, reason: "no-steps"}
    }

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
        logEvaluatorRevisionDebug("[EvalRunDetails2] ensureEvaluatorRevisions skipped", {
            runId,
            projectId,
            source,
            reason: "no-missing-revisions",
            stepCount: steps.length,
        })
        patchedRunRevisionSet.add(runKey)
        return {run: rawRun, patched: false, reason: "no-missing-revisions"}
    }

    logEvaluatorRevisionDebug("[EvalRunDetails2] Evaluator revision check", {
        runId,
        projectId,
        candidateCount: revisionCandidates.length,
        candidateStepKeys: revisionCandidates.map(({step}) => step?.key),
        stepCount: steps.length,
    })

    const updatedSteps = [...steps]
    let requestAttemptCount = 0
    let skippedRequestCount = 0
    let resolvedCount = 0
    let emptyRevisionCount = 0
    let requestFailureCount = 0
    let cacheHitCount = 0

    await Promise.all(
        revisionCandidates.map(async ({step, index}) => {
            const payload = buildRevisionPayload(step.references)
            logEvaluatorRevisionDebug("[EvalRunDetails2] Evaluator revision payload", {
                runId,
                stepKey: step?.key,
                payload,
            })
            const evaluatorRef = payload?.evaluator_ref ?? null
            const hasResolvableEvaluatorRef = Boolean(
                evaluatorRef?.id || evaluatorRef?.slug || evaluatorRef?.version,
            )
            if (!payload || !hasResolvableEvaluatorRef) {
                skippedRequestCount += 1
                logEvaluatorRevisionDebug(
                    "[EvalRunDetails2] Skipping evaluator revision retrieval due to missing evaluator ref",
                    {
                        runId,
                        stepKey: step?.key,
                        payload,
                    },
                )
                return
            }

            const refCacheKey = buildEvaluatorRefCacheKey({
                projectId,
                evaluatorRef,
            })
            const hasCachedResolution = resolvedEvaluatorByRefCache.has(refCacheKey)
            if (hasCachedResolution) {
                cacheHitCount += 1
            }

            let resolvedRefs = hasCachedResolution
                ? (resolvedEvaluatorByRefCache.get(refCacheKey) ?? null)
                : null

            if (!hasCachedResolution) {
                try {
                    requestAttemptCount += 1
                    const response = await axios.post(
                        `/preview/evaluators/revisions/retrieve`,
                        payload,
                        {
                            params: {project_id: projectId},
                        },
                    )
                    const revision =
                        response?.data?.revision ?? response?.data?.data ?? response?.data ?? null
                    const revisionPayload =
                        revision?.evaluator_revision &&
                        typeof revision.evaluator_revision === "object"
                            ? revision.evaluator_revision
                            : revision
                    logEvaluatorRevisionDebug(
                        "[EvalRunDetails2] Evaluator revision retrieve response",
                        {
                            runId,
                            stepKey: step?.key,
                            revision,
                            revisionPayload,
                            rawResponse: response?.data,
                        },
                    )

                    if (revisionPayload && (revisionPayload.id || revisionPayload.slug)) {
                        const evaluatorRevision = {
                            id: revisionPayload.id ?? undefined,
                            slug: revisionPayload.slug ?? undefined,
                            version: revisionPayload.version ?? revision?.version ?? undefined,
                        }
                        const evaluatorVariantId =
                            revisionPayload.evaluator_variant_id ??
                            revisionPayload.variant_id ??
                            revisionPayload.workflow_variant_id ??
                            revision?.evaluator_variant_id ??
                            revision?.variant_id ??
                            revision?.workflow_variant_id

                        resolvedRefs = {
                            evaluator_revision: evaluatorRevision,
                            ...(evaluatorVariantId
                                ? {
                                      evaluator_variant: {
                                          id: evaluatorVariantId,
                                          slug:
                                              revisionPayload.variant_slug ??
                                              revisionPayload.slug ??
                                              undefined,
                                          version:
                                              revisionPayload.variant_version ??
                                              revisionPayload.version ??
                                              revision?.version ??
                                              undefined,
                                      },
                                  }
                                : {}),
                        }
                        resolvedEvaluatorByRefCache.set(refCacheKey, resolvedRefs)
                    } else {
                        emptyRevisionCount += 1
                        resolvedEvaluatorByRefCache.set(refCacheKey, null)
                        console.warn(
                            "[EvalRunDetails2] Evaluator revision retrieve returned empty payload",
                            {
                                runId,
                                stepKey: step?.key,
                                payload,
                                response: response?.data,
                            },
                        )
                    }
                } catch (error) {
                    requestFailureCount += 1
                    console.warn("[EvalRunDetails2] Failed to retrieve evaluator revision", {
                        runId,
                        stepKey: step?.key,
                        error,
                    })
                }
            }

            if (resolvedRefs?.evaluator_revision?.id || resolvedRefs?.evaluator_revision?.slug) {
                const nextReferences = {
                    ...step.references,
                    evaluator_revision: {
                        ...(step.references.evaluator_revision ?? {}),
                        ...resolvedRefs.evaluator_revision,
                    },
                    ...(resolvedRefs.evaluator_variant
                        ? {
                              evaluator_variant: {
                                  ...(step.references.evaluator_variant ?? {}),
                                  ...resolvedRefs.evaluator_variant,
                              },
                          }
                        : {}),
                }

                const nextStep = {
                    ...step,
                    references: nextReferences,
                }

                resolvedCount += 1
                updatedSteps[index] = nextStep
                logEvaluatorRevisionDebug("[EvalRunDetails2] Retrieved evaluator revision", {
                    runId,
                    stepKey: step?.key,
                    revision: resolvedRefs.evaluator_revision,
                    cacheHit: hasCachedResolution,
                })
            }
        }),
    )

    logEvaluatorRevisionDebug("[EvalRunDetails2] ensureEvaluatorRevisions retrieval summary", {
        runId,
        projectId,
        candidateCount: revisionCandidates.length,
        requestAttemptCount,
        skippedRequestCount,
        resolvedCount,
        emptyRevisionCount,
        requestFailureCount,
        cacheHitCount,
    })

    const didUpdate = updatedSteps.some((step: any, index: number) => step !== steps[index])

    if (!didUpdate) {
        logEvaluatorRevisionDebug("[EvalRunDetails2] Evaluator revision update skipped", {
            runId,
            projectId,
            source,
            reason: "no-step-updates",
            candidateCount: revisionCandidates.length,
            requestAttemptCount,
            skippedRequestCount,
            resolvedCount,
            emptyRevisionCount,
            requestFailureCount,
        })
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
    const resolvedRefsForRun = new Map<string, {evaluator_revision: any; evaluator_variant?: any}>()
    updatedSteps.forEach((step: any) => {
        if (!step || step.type !== "annotation" || typeof step.key !== "string") return
        if (!step.references?.evaluator_revision) return
        resolvedRefsForRun.set(step.key, {
            evaluator_revision: step.references.evaluator_revision,
            ...(step.references.evaluator_variant
                ? {evaluator_variant: step.references.evaluator_variant}
                : {}),
        })
    })
    if (resolvedRefsForRun.size > 0) {
        resolvedEvaluatorRefsByRunKey.set(runKey, resolvedRefsForRun)
    }

    logEvaluatorRevisionDebug("[EvalRunDetails2] Applied local evaluator revision enrichment", {
        runId,
        projectId,
        source,
        resolvedCount,
        enrichedStepCount: resolvedRefsForRun.size,
    })
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

                let normalizedRun = rawRun
                if (projectId && runId) {
                    const {
                        run: ensuredRun,
                        patched,
                        reason,
                    } = await ensureEvaluatorRevisions({
                        runId,
                        projectId,
                        rawRun,
                        source: "evaluationRunQueryAtomFamily",
                    })
                    if (patched || reason !== "already-patched-in-session") {
                        logEvaluatorRevisionDebug(
                            "[EvalRunDetails2] ensureEvaluatorRevisions completed for evaluationRunQueryAtomFamily",
                            {
                                runId,
                                projectId,
                                patched,
                                reason,
                            },
                        )
                    }
                    normalizedRun = ensuredRun
                }

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

                    let normalizedRun = rawRun
                    if (projectId && runId) {
                        const {
                            run: ensuredRun,
                            patched,
                            reason,
                        } = await ensureEvaluatorRevisions({
                            runId,
                            projectId,
                            rawRun,
                            source: "evaluationRunWithProjectQueryAtomFamily",
                        })
                        if (patched || reason !== "already-patched-in-session") {
                            logEvaluatorRevisionDebug(
                                "[EvalRunDetails2] ensureEvaluatorRevisions completed for evaluationRunWithProjectQueryAtomFamily",
                                {
                                    runId,
                                    projectId,
                                    patched,
                                    reason,
                                },
                            )
                        }
                        normalizedRun = ensuredRun
                    }

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
