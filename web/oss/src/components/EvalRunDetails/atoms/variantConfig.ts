import {fetchWorkflowRevisionById} from "@agenta/entities/workflow"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {effectiveProjectIdAtom} from "./run"
import {evaluationRunQueryAtomFamily} from "./table/run"

/**
 * Shape returned by the atom — compatible with the legacy `VariantConfigResponse`
 * so that existing consumers (`InvocationSection`, `ConfigurationView`) keep working.
 */
export interface EvaluationVariantConfig {
    params?: Record<string, any>
    url?: string | null
    application_ref?: {
        id?: string
        slug?: string
    }
    variant_ref?: {
        id?: string
        slug?: string
        version?: number | null
        name?: string | null
    }
    service_ref?: {
        id?: string
        slug?: string
        version?: number | null
    }
}

const pickInvocationReference = (runQuery: any) => {
    const runData = runQuery?.data
    if (!runData?.runIndex) {
        return {stepKey: undefined, refs: undefined}
    }

    const invocationKeys = Array.from(runData.runIndex.invocationKeys ?? [])
    const primaryKey = invocationKeys[0]
    if (!primaryKey) {
        return {stepKey: undefined, refs: undefined}
    }

    const stepMeta = runData.runIndex.steps?.[primaryKey]
    return {
        stepKey: primaryKey,
        refs: stepMeta?.refs ?? {},
    }
}

/**
 * Extract the revision ID from run invocation references.
 * The revision ID is used as the primary lookup key for `fetchWorkflowRevisionById`.
 */
const extractRevisionId = (refs: Record<string, any> | undefined): string | undefined => {
    if (!refs) return undefined

    const revision =
        refs.applicationRevision ||
        refs.application_revision ||
        refs.revision ||
        refs.revision_ref ||
        {}

    const variant =
        refs.applicationVariant ||
        refs.application_variant ||
        refs.variant ||
        refs.variant_ref ||
        {}

    return (
        revision.id ||
        revision.revisionId ||
        revision.revision_id ||
        variant.id ||
        variant.variantId ||
        variant.variant_id ||
        undefined
    )
}

export const evaluationVariantConfigAtomFamily = atomFamily((runId: string | null) =>
    atomWithQuery<EvaluationVariantConfig | null>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        const runQuery = runId ? get(evaluationRunQueryAtomFamily(runId)) : undefined

        // Wait for the run query to finish loading before determining enabled state.
        const isRunQueryLoading = runQuery?.isPending || runQuery?.isFetching

        const refs = runQuery ? pickInvocationReference(runQuery).refs : undefined
        const revisionId = extractRevisionId(refs)

        const enabled = Boolean(projectId && runId && revisionId && !isRunQueryLoading)

        return {
            queryKey: [
                "preview",
                "evaluation",
                "variant-config",
                projectId ?? null,
                runId ?? null,
                revisionId ?? null,
            ],
            enabled,
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async (): Promise<EvaluationVariantConfig | null> => {
                if (!enabled || !projectId || !revisionId) {
                    return null
                }

                try {
                    const workflow = await fetchWorkflowRevisionById(revisionId, projectId)

                    // Map Workflow → EvaluationVariantConfig (compatible with legacy shape)
                    return {
                        params: (workflow.data?.parameters as Record<string, any>) ?? undefined,
                        url: workflow.data?.url ?? null,
                        application_ref: {
                            id: workflow.workflow_id ?? undefined,
                            slug: workflow.slug ?? undefined,
                        },
                        variant_ref: {
                            id: workflow.id,
                            slug: workflow.slug ?? undefined,
                            version: typeof workflow.version === "number" ? workflow.version : null,
                            name: workflow.name ?? null,
                        },
                    }
                } catch (error: any) {
                    if (error?.response?.status === 404) {
                        return null
                    }
                    throw error
                }
            },
        }
    }),
)
