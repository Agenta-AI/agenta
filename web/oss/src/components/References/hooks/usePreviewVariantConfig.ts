import {useMemo} from "react"

import {workflowMolecule, workflowVariantsListQueryStateAtomFamily} from "@agenta/entities/workflow"
import {getDefaultStore, useAtomValue} from "jotai"

interface VariantConfig {
    variantName: string | null
    revision: number | null
}

interface UsePreviewVariantConfigOptions {
    enabled?: boolean
}

const usePreviewVariantConfig = (
    {
        projectId: _projectId,
        revisionId,
    }: {
        projectId: string | null | undefined
        revisionId: string | null | undefined
    },
    options?: UsePreviewVariantConfigOptions,
) => {
    const enabled = options?.enabled ?? true
    const effectiveRevisionId = enabled && revisionId ? revisionId : ""

    const dataAtom = useMemo(
        () => workflowMolecule.selectors.data(effectiveRevisionId),
        [effectiveRevisionId],
    )
    const queryAtom = useMemo(
        () => workflowMolecule.selectors.query(effectiveRevisionId),
        [effectiveRevisionId],
    )

    // Read from default store to bypass scoped store isolation
    // (e.g. EvaluationRunsTableStoreProvider)
    const defaultStore = getDefaultStore()
    const data = useAtomValue(dataAtom, {store: defaultStore})
    const query = useAtomValue(queryAtom, {store: defaultStore})

    // Resolve the VARIANT name, not the revision name. The default variant's
    // revisions are historically named after the app ("completion-1"), so using
    // the revision name renders the default variant as the app name instead of
    // "default". Look the variant up by the revision's workflow_variant_id.
    const variantsAtom = useMemo(
        () => workflowVariantsListQueryStateAtomFamily(data?.workflow_id ?? ""),
        [data?.workflow_id],
    )
    const variantsState = useAtomValue(variantsAtom, {store: defaultStore})
    const variantName = useMemo(() => {
        const variantId = data?.workflow_variant_id
        if (!variantId) return null
        const match = (variantsState.data ?? []).find((v) => v.id === variantId)
        // SDK-created variants may carry no name; the slug ("default") is
        // still the right label.
        return match?.name ?? match?.slug ?? null
    }, [data?.workflow_variant_id, variantsState.data])

    const config: VariantConfig | null =
        enabled && revisionId && data
            ? {
                  variantName: variantName ?? data.name ?? data.slug ?? null,
                  revision: data.version ?? null,
              }
            : null

    const isLoading = Boolean(enabled && revisionId && !config && query.isPending)

    return {config, isLoading}
}

export default usePreviewVariantConfig
