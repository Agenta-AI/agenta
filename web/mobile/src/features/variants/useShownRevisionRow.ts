import {useMemo} from "react"

import {
    pickModelName,
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import type {AppRevisionRow} from "./useAppRevisions"

/**
 * The row for the revision open in the drawer. A loaded row is used as is. A revision outside
 * the loaded pages (a link to an old one) is built from its own record, so the drawer's Deploy
 * does not depend on how far the table has loaded.
 */
export const useShownRevisionRow = ({
    revisionId,
    appId,
    rows,
}: {
    revisionId: string | null
    appId: string
    rows: readonly AppRevisionRow[]
}): AppRevisionRow | null => {
    const loaded = revisionId ? (rows.find((row) => row.revisionId === revisionId) ?? null) : null
    const entity = useAtomValue(workflowMolecule.selectors.data(loaded ? "" : (revisionId ?? "")))
    const variants = useAtomValue(workflowVariantsListDataAtomFamily(appId))

    return useMemo(() => {
        if (loaded) return loaded
        if (!revisionId || !entity?.id || entity.workflow_id !== appId) return null
        const variantId = entity.workflow_variant_id ?? entity.variant_id ?? ""
        const variant = variants.find((item) => item.id === variantId)
        return {
            revisionId,
            workflowId: appId,
            variantId,
            variantName: variant?.name ?? variant?.slug ?? entity.name ?? variantId,
            variantSlug: variant?.slug ?? entity.variant_slug ?? null,
            version: Number(entity.version ?? 0),
            model: pickModelName(entity.data?.parameters ?? null),
            message: entity.message ?? null,
            createdAt: entity.created_at ?? null,
            createdById: entity.created_by_id ?? null,
        }
    }, [appId, entity, loaded, revisionId, variants])
}
