import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchVariantConfig, VariantConfigResponse} from "@/oss/services/variantConfigs/api"

import {effectiveProjectIdAtom} from "./run"
import {evaluationRunQueryAtomFamily} from "./table/run"

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

const normalizeVariantReference = (refs: Record<string, any> | undefined) => {
    if (!refs) {
        return {
            application: undefined,
            variant: undefined,
        }
    }

    const application =
        refs.application ||
        refs.application_ref ||
        refs.applicationRef ||
        refs.app ||
        refs.app_ref ||
        refs.appRef ||
        {}

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

    const variantId =
        revision.id ||
        revision.revisionId ||
        revision.revision_id ||
        variant.id ||
        variant.variantId ||
        variant.variant_id

    const variantSlug =
        variant.slug ||
        variant.variantSlug ||
        variant.variant_slug ||
        revision.slug ||
        revision.revisionSlug ||
        revision.revision_slug ||
        undefined

    const variantVersion =
        revision.version ?? revision.revision ?? variant.version ?? variant.revision ?? null

    return {
        application: {
            id: application.id,
            slug: application.slug,
        },
        variant: {
            id: variantId ? String(variantId) : undefined,
            slug: variantSlug ? String(variantSlug) : undefined,
            version:
                typeof variantVersion === "number" || variantVersion === null
                    ? variantVersion
                    : typeof variantVersion === "string" && variantVersion.trim() !== ""
                      ? Number(variantVersion)
                      : null,
        },
    }
}

export const evaluationVariantConfigAtomFamily = atomFamily((runId: string | null) =>
    atomWithQuery<VariantConfigResponse | null>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        const runQuery = runId ? get(evaluationRunQueryAtomFamily(runId)) : undefined

        const {refs} = runQuery
            ? pickInvocationReference(runQuery)
            : {stepKey: undefined, refs: undefined}
        const reference = normalizeVariantReference(refs)

        const hasVariantRef = Boolean(reference.variant?.id || reference.variant?.slug)
        const enabled = Boolean(projectId && runId && hasVariantRef)

        return {
            queryKey: [
                "preview",
                "evaluation",
                "variant-config",
                projectId ?? null,
                runId ?? null,
                reference.variant?.id ?? null,
                reference.variant?.slug ?? null,
                reference.variant?.version ?? null,
            ],
            enabled,
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!enabled || !projectId) {
                    return null
                }

                return fetchVariantConfig({
                    projectId,
                    application: {
                        id: reference.application?.id,
                        slug: reference.application?.slug,
                    },
                    variant: {
                        id: reference.variant?.id,
                        slug: reference.variant?.slug,
                        version: reference.variant?.version ?? null,
                    },
                })
            },
        }
    }),
)
