/**
 * Workflow Entity Bridge — Side Effects Only
 *
 * Registers playground-specific orchestration with the entity layer:
 * 1. Selection change callback (URL sync, drawer state)
 * 2. Commit callbacks (query invalidation, selection swap)
 * 3. Archive callbacks (query invalidation, selection cleanup)
 *
 * This module has no exports — import it for side effects only:
 * ```typescript
 * import "@/oss/state/newPlayground/workflowEntityBridge"
 * ```
 */

import {invalidateEntityQueries} from "@agenta/entities/shared/invalidation"
import {
    registerWorkflowCommitCallbacks,
    registerWorkflowArchiveCallbacks,
    workflowRevisionsByWorkflowQueryAtomFamily,
    workflowRevisionsListDataAtomFamily,
    workflowRevisionsQueryAtomFamily,
    workflowVariantsListDataAtomFamily,
    workflowVariantsQueryAtomFamily,
    workflowMolecule,
    type WorkflowCommitResult,
    type WorkflowArchiveResult,
} from "@agenta/entities/workflow"
import {playgroundController, setOnSelectionChangeCallback} from "@agenta/playground"
import {
    workflowRevisionDrawerEntityIdAtom as drawerVariantIdAtom,
    workflowRevisionDrawerExpandedAtom,
} from "@agenta/playground-ui/workflow-revision-drawer"
import {getDefaultStore} from "jotai"

import {
    registryPaginatedStore,
    clearRegistryVariantNameCache,
} from "@/oss/components/VariantsComponents/store/registryStore"
import {routerAppNavigationAtom} from "@/oss/state/app"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

// ============================================================================
// SELECTION CHANGE CALLBACK
// OSS-specific side-effects when playground selection changes
// ============================================================================

setOnSelectionChangeCallback((entityIds, _removed) => {
    const store = getDefaultStore()

    // Skip URL sync when running inside the drawer's embedded playground.
    // The drawer sets entity IDs via playgroundController but does NOT use
    // URL-based state — writing the URL on a non-playground page causes
    // cascading side effects and can freeze the page.
    const isDrawerExpanded = store.get(workflowRevisionDrawerExpandedAtom)

    if (!isDrawerExpanded) {
        // Sync selection to URL (only on the actual playground page)
        void writePlaygroundSelectionToQuery(entityIds)
    }

    // Keep drawer selection consistent
    const currentDrawerId = store.get(drawerVariantIdAtom)
    if (!currentDrawerId || !entityIds.includes(currentDrawerId)) {
        store.set(drawerVariantIdAtom, entityIds[0] ?? null)
    }
})

const findAdjacentId = (ids: string[], targetId: string) => {
    const targetIndex = ids.findIndex((id) => id === targetId)
    if (targetIndex === -1) return ids[0] ?? null

    return ids[targetIndex + 1] ?? ids[targetIndex - 1] ?? null
}

const getRevisionVariantId = (revisionId: string) => {
    const workflow = workflowMolecule.get.data(revisionId)
    return workflow?.workflow_variant_id ?? workflow?.variant_id ?? null
}

const isVisibleWorkflowRevision = (
    workflow: {id?: string | null; version?: number | null} | null | undefined,
) => Boolean(workflow?.id) && Number(workflow?.version ?? 0) > 0

const extractVisibleRevisionIds = (
    revisions: {id?: string | null; version?: number | null}[] | null | undefined,
    excludeId?: string,
) =>
    (revisions ?? [])
        .filter(isVisibleWorkflowRevision)
        .map((r) => r.id)
        .filter((id): id is string => Boolean(id) && id !== excludeId)

const resolveRemainingWorkflowRevisionId = async ({
    revisionId,
    workflowId,
}: {
    revisionId: string
    workflowId: string
}) => {
    const store = getDefaultStore()

    const getVariantRevisionIds = (variantId: string) =>
        extractVisibleRevisionIds(
            store.get(workflowRevisionsListDataAtomFamily(variantId)),
            revisionId,
        )

    const getVariantRevisionIdsWithRefetch = async (variantId: string) => {
        const cachedRevisionIds = getVariantRevisionIds(variantId)
        if (cachedRevisionIds.length > 0) return cachedRevisionIds

        const query = store.get(workflowRevisionsQueryAtomFamily(variantId))
        if (!query.refetch) return []

        try {
            const refetched = await query.refetch()
            return extractVisibleRevisionIds(refetched.data?.refs, revisionId)
        } catch (error) {
            console.warn(
                "[workflowEntityBridge] Failed to refetch adjacent variant revisions:",
                error,
            )
            return []
        }
    }

    const findAdjacentVariantRevisionId = async (variantIds: string[], targetVariantId: string) => {
        const targetIndex = variantIds.findIndex((id) => id === targetVariantId)
        if (targetIndex === -1) return null

        for (let i = targetIndex + 1; i < variantIds.length; i += 1) {
            const adjacentRevisionId = (await getVariantRevisionIdsWithRefetch(variantIds[i]!)).at(
                0,
            )
            if (adjacentRevisionId) return adjacentRevisionId
        }

        for (let i = targetIndex - 1; i >= 0; i -= 1) {
            const adjacentRevisionId = (await getVariantRevisionIdsWithRefetch(variantIds[i]!)).at(
                0,
            )
            if (adjacentRevisionId) return adjacentRevisionId
        }

        return null
    }

    const variantId = getRevisionVariantId(revisionId)
    if (variantId) {
        // Try cached sibling revisions within the same variant
        const cachedSiblingIds = extractVisibleRevisionIds(
            store.get(workflowRevisionsListDataAtomFamily(variantId)),
        )
        const cachedSiblingId = findAdjacentId(cachedSiblingIds, revisionId)
        if (cachedSiblingId && cachedSiblingId !== revisionId) {
            return cachedSiblingId
        }

        // Refetch variant revisions if cache missed
        const variantRevisionsQuery = store.get(workflowRevisionsQueryAtomFamily(variantId))
        if (variantRevisionsQuery.refetch) {
            try {
                const refetched = await variantRevisionsQuery.refetch()
                const refetchedSiblingId = findAdjacentId(
                    extractVisibleRevisionIds(refetched.data?.refs, revisionId),
                    revisionId,
                )
                if (refetchedSiblingId) return refetchedSiblingId
            } catch (error) {
                console.warn(
                    "[workflowEntityBridge] Failed to refetch variant revisions after delete:",
                    error,
                )
            }
        }

        // Try adjacent variants (cached)
        const cachedVariantIds = store
            .get(workflowVariantsListDataAtomFamily(workflowId))
            .map((variant) => variant.id)
            .filter((id): id is string => Boolean(id))
        const cachedAdjacentVariantRevisionId = await findAdjacentVariantRevisionId(
            cachedVariantIds,
            variantId,
        )
        if (cachedAdjacentVariantRevisionId) return cachedAdjacentVariantRevisionId

        // Refetch variants list and try adjacent
        const variantsQuery = store.get(workflowVariantsQueryAtomFamily(workflowId))
        if (variantsQuery.refetch) {
            try {
                const refetched = await variantsQuery.refetch()
                const refetchedVariantIds =
                    refetched.data?.workflow_variants
                        ?.map((variant) => variant.id)
                        .filter((id): id is string => Boolean(id)) ?? []
                const refetchedAdjacentVariantRevisionId = await findAdjacentVariantRevisionId(
                    refetchedVariantIds,
                    variantId,
                )
                if (refetchedAdjacentVariantRevisionId) return refetchedAdjacentVariantRevisionId
            } catch (error) {
                console.warn("[workflowEntityBridge] Failed to refetch workflow variants:", error)
            }
        }
    }

    // Final fallback: refetch all workflow revisions
    const revisionsQuery = store.get(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))
    if (!revisionsQuery.refetch) return null

    try {
        const refetched = await revisionsQuery.refetch()
        return extractVisibleRevisionIds(refetched.data?.refs, revisionId).at(0) ?? null
    } catch (error) {
        console.warn(
            "[workflowEntityBridge] Failed to refetch workflow revisions after delete:",
            error,
        )
        return null
    }
}

// ============================================================================
// COMMIT CALLBACKS
// Wire playground-specific orchestration into workflow's commit flow
// ============================================================================

registerWorkflowCommitCallbacks({
    onQueryInvalidate: async () => {
        // Only invalidate entity-level queries (oss-variants-for-selection, etc.)
        // for cross-page cache busting. Workflow-specific queries (list, variants,
        // revisions) are already invalidated by the commit/archive atoms directly.
        // Calling invalidateQueriesAtom here would redundantly refetch ALL
        // ["workflows"] queries including heavy per-revision schema queries.
        await invalidateEntityQueries()

        // Refresh registry paginated store so registry/variant tables update
        clearRegistryVariantNameCache()
        const store = getDefaultStore()
        store.set(registryPaginatedStore.actions.refresh)
    },
    onNewRevision: async (result: WorkflowCommitResult) => {
        const store = getDefaultStore()
        const {revisionId, newRevisionId} = result

        // Use the controller's switchEntity action which handles:
        // 1. Swapping the entity ID in the selection
        // 2. Duplicating chat history
        // 3. Notifying the selection change callback (URL sync, drawer state)
        store.set(playgroundController.actions.switchEntity, {
            currentEntityId: revisionId,
            newEntityId: newRevisionId,
        })
    },
})

// ============================================================================
// ARCHIVE CALLBACKS
// Wire playground-specific orchestration into workflow's archive flow
// ============================================================================

registerWorkflowArchiveCallbacks({
    onQueryInvalidate: async () => {
        // Same as commit — only entity-level queries. Workflow-specific
        // invalidation is handled by archiveWorkflowRevisionAtom directly.
        await invalidateEntityQueries()

        // Refresh registry paginated store so registry/variant tables update
        clearRegistryVariantNameCache()
        const store = getDefaultStore()
        store.set(registryPaginatedStore.actions.refresh)
    },
    onRevisionDeleted: async (result: WorkflowArchiveResult) => {
        const store = getDefaultStore()
        const {revisionId, workflowId} = result

        // Remove the archived revision from the selection
        const currentIds = store.get(playgroundController.selectors.entityIds())
        const updatedIds = currentIds.filter((id) => id !== revisionId)

        if (updatedIds.length > 0) {
            store.set(playgroundController.actions.setEntityIds, updatedIds)
            void writePlaygroundSelectionToQuery(updatedIds)
        } else {
            // The deleted revision was the only one selected.
            // Prefer an adjacent remaining revision from the cached order,
            // then fall back to a refetch before leaving the playground.
            const replacementRevisionId = await resolveRemainingWorkflowRevisionId({
                revisionId,
                workflowId,
            })

            if (replacementRevisionId) {
                store.set(playgroundController.actions.setEntityIds, [replacementRevisionId])
                void writePlaygroundSelectionToQuery([replacementRevisionId])
            } else {
                // No remaining revisions — navigate back to apps list
                store.set(playgroundController.actions.setEntityIds, [])
                store.set(routerAppNavigationAtom, null)
            }
        }
    },
})
