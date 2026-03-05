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

const ensureEvaluatorRevisions = async ({
    runId,
    projectId,
    rawRun,
}: {
    runId: string
    projectId: string
    rawRun: EvaluationRun
}): Promise<{run: EvaluationRun; patched: boolean}> => {
    if (patchedRunRevisionSet.has(runId)) {
        return {run: rawRun, patched: false}
    }

    const steps = Array.isArray(rawRun?.data?.steps) ? rawRun.data.steps : []
    if (!steps.length) {
        patchedRunRevisionSet.add(runId)
        return {run: rawRun, patched: false}
    }

    let hasMissingRevision = false
    steps.forEach((step: any) => {
        if (
            step &&
            step.type === "annotation" &&
            step.references &&
            step.references.evaluator &&
            !step.references.evaluator_revision
        ) {
            hasMissingRevision = true
        }
    })

    if (!hasMissingRevision) {
        patchedRunRevisionSet.add(runId)
        return {run: rawRun, patched: false}
    }

    if (process.env.NODE_ENV !== "production") {
        console.debug("[EvalRunDetails2] Evaluator revision check", {
            runId,
            projectId,
            missingRevision: hasMissingRevision,
            stepCount: steps.length,
            steps: steps.map((step: any) => ({
                key: step?.key,
                type: step?.type,
                origin: step?.origin,
                hasEvaluator: Boolean(step?.references?.evaluator),
                hasRevision: Boolean(step?.references?.evaluator_revision),
                references: step?.references,
            })),
        })
    }

    const updatedSteps = await Promise.all(
        steps.map(async (step: any) => {
            if (
                !step ||
                step.type !== "annotation" ||
                !step.references ||
                !step.references.evaluator ||
                step.references.evaluator_revision
            ) {
                return step
            }

            const payload = buildRevisionPayload(step.references)
            if (process.env.NODE_ENV !== "production") {
                console.debug("[EvalRunDetails2] Evaluator revision payload", {
                    runId,
                    stepKey: step?.key,
                    payload,
                })
            }
            if (!payload || !payload.evaluator_ref?.id) {
                if (process.env.NODE_ENV !== "production") {
                    console.debug(
                        "[EvalRunDetails2] Skipping evaluator revision retrieval due to missing ref",
                        {
                            runId,
                            stepKey: step?.key,
                            payload,
                        },
                    )
                }
                return step
            }

            try {
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
                    revision?.evaluator_revision && typeof revision.evaluator_revision === "object"
                        ? revision.evaluator_revision
                        : revision
                if (process.env.NODE_ENV !== "production") {
                    console.debug("[EvalRunDetails2] Evaluator revision retrieve response", {
                        runId,
                        stepKey: step?.key,
                        revision,
                        revisionPayload,
                        rawResponse: response?.data,
                    })
                }
                if (revisionPayload && (revisionPayload.id || revisionPayload.slug)) {
                    const nextReferences = {
                        ...step.references,
                        evaluator_revision: {
                            id:
                                revisionPayload.id ??
                                step.references.evaluator_revision?.id ??
                                undefined,
                            slug:
                                revisionPayload.slug ??
                                step.references.evaluator_revision?.slug ??
                                undefined,
                            version:
                                revisionPayload.version ??
                                revision?.version ??
                                step.references.evaluator_revision?.version ??
                                undefined,
                        },
                    }
                    const evaluatorVariantId =
                        revisionPayload.evaluator_variant_id ??
                        revisionPayload.variant_id ??
                        revisionPayload.workflow_variant_id ??
                        revision?.evaluator_variant_id ??
                        revision?.variant_id ??
                        revision?.workflow_variant_id ??
                        step.references.evaluator_variant?.id
                    if (evaluatorVariantId) {
                        nextReferences.evaluator_variant = {
                            id: evaluatorVariantId,
                            slug:
                                revisionPayload.variant_slug ??
                                revisionPayload.slug ??
                                step.references.evaluator_variant?.slug,
                            version:
                                revisionPayload.variant_version ??
                                revisionPayload.version ??
                                revision?.version ??
                                step.references.evaluator_variant?.version,
                        }
                    }

                    const nextStep = {
                        ...step,
                        references: nextReferences,
                    }
                    if (process.env.NODE_ENV !== "production") {
                        console.debug("[EvalRunDetails2] Retrieved evaluator revision", {
                            runId,
                            stepKey: step?.key,
                            revision: revisionPayload,
                            nextStep,
                        })
                    }
                    return nextStep
                }
            } catch (error) {
                console.warn("[EvalRunDetails2] Failed to retrieve evaluator revision", {
                    runId,
                    stepKey: step?.key,
                    error,
                })
            }

            return step
        }),
    )

    const didUpdate = updatedSteps.some((step: any, index: number) => step !== steps[index])

    if (!didUpdate) {
        if (process.env.NODE_ENV !== "production") {
            console.debug("[EvalRunDetails2] Evaluator revision update skipped", {
                runId,
                reason: "no-step-updates",
            })
        }
        patchedRunRevisionSet.add(runId)
        return {run: rawRun, patched: false}
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
        await axios.patch(
            `/preview/evaluations/runs/${encodeURIComponent(runId)}`,
            {run: patchedRun},
            {
                params: {project_id: projectId},
                _ignoreError: true,
            } as any,
        )
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
        console.info("[EvalRunDetails2] Skipping metrics refresh after patch (debug mode)", {
            runId,
            projectId,
        })
        console.info("[EvalRunDetails2] Patched run with evaluator revisions", {
            runId,
        })
        patchedRunRevisionSet.add(runId)
        return {run: patchedRun, patched: true}
    } catch (error) {
        console.warn("[EvalRunDetails2] Failed to patch run with evaluator revisions", {
            runId,
            error,
        })
        return {run: rawRun, patched: false}
    }
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
                    const {run: ensuredRun} = await ensureEvaluatorRevisions({
                        runId,
                        projectId,
                        rawRun,
                    })
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
                        const {run: ensuredRun} = await ensureEvaluatorRevisions({
                            runId,
                            projectId,
                            rawRun,
                        })
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
