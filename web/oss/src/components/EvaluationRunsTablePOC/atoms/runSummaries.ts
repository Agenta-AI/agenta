import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"

import {getPreviewRunBatcher} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"

export interface PreviewRunSummary {
    id: string
    name: string | null
    status: string | null
    createdAt: string | null
    createdById: string | null
    appId: string | null
    testsetIds: string[]
    testsetNames: Record<string, string | null>
    stepReferences: Record<string, unknown>
    flags: Record<string, unknown>
}

const collectTestsetReferences = (
    run: any,
): {
    ids: string[]
    stepReferences: Record<string, unknown>
    namesById: Record<string, string | null>
} => {
    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
    const ids = new Set<string>()
    const referencesByStep: Record<string, unknown> = {}
    const namesById: Record<string, string | null> = {}
    steps.forEach((step: any) => {
        const references = step?.references
        if (!references || typeof references !== "object") {
            return
        }
        const stepKey = typeof step?.step === "string" ? step.step : undefined
        if (stepKey) {
            referencesByStep[stepKey] = references
        }
        const maybeTestset = references.testset ?? references.test_set ?? references.testsetVariant
        if (maybeTestset && typeof maybeTestset.id === "string") {
            const id = maybeTestset.id
            ids.add(id)
            if (typeof maybeTestset.name === "string" && maybeTestset.name.trim().length > 0) {
                namesById[id] = maybeTestset.name
            } else if (!(id in namesById)) {
                namesById[id] = null
            }
        }
        const nested = references?.testsets
        if (Array.isArray(nested)) {
            nested.forEach((ref: any) => {
                if (ref && typeof ref.id === "string") {
                    ids.add(ref.id)
                    if (typeof ref.name === "string" && ref.name.trim().length > 0) {
                        namesById[ref.id] = ref.name
                    } else if (!(ref.id in namesById)) {
                        namesById[ref.id] = null
                    }
                }
            })
        }
    })
    return {
        ids: Array.from(ids),
        stepReferences: referencesByStep,
        namesById,
    }
}

const resolveAppId = (run: any): string | null => {
    const metaApplication = (run?.meta as any)?.application
    if (metaApplication && typeof metaApplication.id === "string") {
        return metaApplication.id
    }
    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
    for (const step of steps) {
        const references = step?.references
        if (references?.application && typeof references.application.id === "string") {
            return references.application.id
        }
        if (
            references?.application_variant &&
            typeof references.application_variant.id === "string"
        ) {
            return references.application_variant.id
        }
    }
    return typeof run?.appId === "string" ? run.appId : null
}

export const previewRunSummaryAtomFamily = atomFamily(
    ({projectId, runId}: {projectId: string | null; runId: string | null}) =>
        atomWithQuery<PreviewRunSummary | null>(() => {
            return {
                queryKey: ["preview-evaluation-run-summary", projectId ?? "none", runId ?? "none"],
                enabled: Boolean(projectId && runId),
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                queryFn: async () => {
                    if (!projectId || !runId) {
                        return null
                    }

                    const batcher = getPreviewRunBatcher()
                    const rawRun = await batcher({projectId, runId})
                    if (!rawRun) {
                        return null
                    }

                    const camelRun = snakeToCamelCaseKeys(rawRun) as Record<string, any>
                    const status = (() => {
                        const rawStatus = camelRun?.status
                        if (!rawStatus) return null
                        if (typeof rawStatus === "string") return rawStatus
                        if (typeof rawStatus?.value === "string") return rawStatus.value
                        return String(rawStatus)
                    })()

                    const {ids, stepReferences, namesById} = collectTestsetReferences(camelRun)

                    return {
                        id: camelRun?.id ?? runId,
                        name:
                            (camelRun?.name as string | undefined) ??
                            (camelRun?.displayName as string | undefined) ??
                            null,
                        status: status,
                        createdAt:
                            (camelRun?.createdAt as string | undefined) ??
                            (camelRun?.created_at as string | undefined) ??
                            null,
                        createdById:
                            (camelRun?.createdById as string | undefined) ??
                            (camelRun?.created_by_id as string | undefined) ??
                            null,
                        appId: resolveAppId(camelRun),
                        testsetIds: ids,
                        testsetNames: namesById,
                        stepReferences,
                        flags: (camelRun?.flags as Record<string, unknown>) ?? {},
                    }
                },
            }
        }),
    (a, b) => a.projectId === b.projectId && a.runId === b.runId,
)

export default previewRunSummaryAtomFamily
