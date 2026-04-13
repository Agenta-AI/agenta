import {useCallback, useEffect, useMemo, useState} from "react"

import {
    archiveWorkflowVariant,
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
    workflowRevisionsListDataAtomFamily,
} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {projectIdAtom} from "@agenta/shared/state"
import {EntityNameWithVersion} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {Trash} from "@phosphor-icons/react"
import {Button, Spin, Typography} from "antd"
import {atom, getDefaultStore, useAtomValue, useSetAtom} from "jotai"

import {
    registryPaginatedStore,
    clearRegistryVariantNameCache,
} from "@/oss/components/VariantsComponents/store/registryStore"
import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"

const {Text} = Typography

interface Props {
    revisionIds: string[]
    forceVariantIds?: string[]
    workflowId?: string | null
    onClose: () => void
}

interface VariantGroup {
    variantId: string
    selectedIds: string[]
    totalIds: string[]
    displayName: string
    deleteEntireVariant: boolean
}

const isVisibleWorkflowRevision = (revision: {id?: string | null; version?: number | null}) => {
    if (!revision?.id) return false
    return Number(revision?.version ?? 0) > 0
}

// Stable empty atom for when no entity ID is available
const emptyWorkflowDataAtom = atom(() => null)

// ============================================================================
// SINGLE DELETE CONTENT
// ============================================================================

/**
 * Simplified delete content for a single workflow revision.
 * Uses the archive API via playgroundController.actions.deleteRevision.
 */
const SingleDeleteContent = ({
    revisionIds,
    onClose,
}: {
    revisionIds: string[]
    onClose: () => void
}) => {
    const deleteRevision = useSetAtom(playgroundController.actions.deleteRevision)
    const refreshRegistry = useSetAtom(registryPaginatedStore.actions.refresh)
    const [isMutating, setIsMutating] = useState(false)

    const entityId = revisionIds[0]

    // Memoize the data atom to get the proper entity data with version info
    const dataAtom = useMemo(
        () => (entityId ? workflowMolecule.selectors.data(entityId) : null),
        [entityId],
    )

    // Read workflow entity data
    const workflowData = useAtomValue(dataAtom ?? emptyWorkflowDataAtom)

    // Resolve variant display name from the variants list (same as registry store)
    const variantId = workflowData?.workflow_variant_id ?? workflowData?.variant_id
    const workflowId = workflowData?.workflow_id
    const variantsListAtom = useMemo(
        () =>
            workflowId
                ? workflowVariantsListDataAtomFamily(workflowId)
                : atom<{id?: string; name?: string | null; slug?: string | null}[]>([]),
        [workflowId],
    )
    const variants = useAtomValue(variantsListAtom)
    const variantEntity = variants.find((v) => v.id === variantId)
    const entityName =
        variantEntity?.name ||
        variantEntity?.slug ||
        workflowData?.name ||
        workflowData?.slug ||
        "this revision"
    const entityVersion = workflowData?.version

    // Guard: check if this is the last visible revision across all variants
    const store = getDefaultStore()
    const isLastRevision = useMemo(() => {
        let totalVisible = 0
        for (const variant of variants) {
            if (!variant.id) continue
            const revisions = store.get(workflowRevisionsListDataAtomFamily(variant.id))
            totalVisible += revisions.filter(isVisibleWorkflowRevision).length
        }
        return totalVisible > 0 && totalVisible <= 1
    }, [variants, store])

    const onDelete = useCallback(async () => {
        setIsMutating(true)
        try {
            for (const id of revisionIds) {
                const res = await deleteRevision(id)
                if (!res?.success) {
                    throw new Error(res?.error || "Failed to delete workflow")
                }
            }

            // Selection cleanup (removing deleted ID + finding replacement)
            // is handled by onRevisionDeleted in workflowEntityBridge.ts,
            // which runs inside deleteRevision. No need to call removeEntity
            // here — doing so would clear the selection before the replacement
            // is resolved, causing an empty playground flash.

            // Refresh the registry paginated store so the table updates
            clearRegistryVariantNameCache()
            refreshRegistry()

            message.success("Deleted workflow successfully")
            onClose()
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Failed to delete workflow")
        } finally {
            setIsMutating(false)
        }
    }, [revisionIds, deleteRevision, onClose])

    return (
        <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                <Text>
                    {isLastRevision ? (
                        "Cannot delete the only revision. Delete the app instead."
                    ) : (
                        <>
                            You are about to delete{" "}
                            <Text strong>
                                <EntityNameWithVersion name={entityName} version={entityVersion} />
                            </Text>
                            .
                        </>
                    )}
                </Text>
                {!isLastRevision && <Text type="secondary">This action cannot be undone.</Text>}
            </div>

            <div className="flex items-center justify-end gap-2">
                <Button onClick={onClose}>{isLastRevision ? "Close" : "Cancel"}</Button>
                {!isLastRevision && (
                    <Button
                        type="primary"
                        danger
                        loading={isMutating}
                        disabled={isMutating}
                        icon={<Trash size={14} />}
                        onClick={onDelete}
                    >
                        Delete
                    </Button>
                )}
            </div>
        </section>
    )
}

// ============================================================================
// BULK DELETE CONTENT
// ============================================================================

/**
 * Bulk delete content for multiple workflow revisions/variants.
 * Groups revisions by variant, checks deletion validity, and executes
 * bulk deletion using variant deletion + revision archive APIs.
 */
const BulkDeleteContent = ({
    revisionIds,
    forceVariantIds = [],
    workflowId: passedWorkflowId,
    onClose,
}: Props) => {
    const store = getDefaultStore()
    const deleteRevision = useSetAtom(playgroundController.actions.deleteRevision)
    const invalidatePlaygroundQueries = useSetAtom(playgroundController.actions.invalidateQueries)
    const refreshRegistry = useSetAtom(registryPaginatedStore.actions.refresh)

    const [checking, setChecking] = useState(true)
    const [canDelete, setCanDelete] = useState<boolean | null>(null)
    const [isMutating, setIsMutating] = useState(false)

    // Derive workflowId — prefer passed-in value, fall back to molecule lookup
    const workflowId = useMemo(() => {
        if (passedWorkflowId) return passedWorkflowId
        const firstId = revisionIds[0]
        if (!firstId) return null
        const data = workflowMolecule.get.data(firstId)
        return data?.workflow_id ?? null
    }, [passedWorkflowId, revisionIds])

    // Get variants list for the workflow
    const variantsListAtom = useMemo(
        () =>
            workflowId
                ? workflowVariantsListDataAtomFamily(workflowId)
                : atom<{id?: string; name?: string | null}[]>([]),
        [workflowId],
    )
    const variants = useAtomValue(variantsListAtom)

    const uniqueRevisionIds = useMemo(
        () => Array.from(new Set([revisionIds].flat().filter(Boolean))) as string[],
        [revisionIds],
    )

    // Resolve revision data from workflow molecule
    const resolvedRevisions = useMemo(
        () =>
            uniqueRevisionIds
                .map((id) => workflowMolecule.get.data(id))
                .filter(Boolean) as NonNullable<ReturnType<typeof workflowMolecule.get.data>>[],
        [uniqueRevisionIds],
    )

    // Build variant name map
    const variantNameMap = useMemo(() => {
        const map: Record<string, string> = {}
        variants.forEach((variant) => {
            if (!variant?.id) return
            map[variant.id] = (variant.name as string) || variant.id
        })
        return map
    }, [variants])

    // Group revisions by variant
    const variantGroups = useMemo(() => {
        const groups: Record<string, VariantGroup> = {}
        const forceVariantIdSet = new Set(forceVariantIds)

        // Build groups from molecule-resolved revisions
        resolvedRevisions.forEach((rev) => {
            const variantId = rev.workflow_variant_id ?? rev.variant_id
            if (!variantId) return

            const existing = groups[variantId]
            const selectedIds = [...(existing?.selectedIds || []), rev.id].filter(
                Boolean,
            ) as string[]
            const totalIds = existing?.totalIds || []
            const displayName = existing?.displayName ?? variantNameMap[variantId] ?? "-"

            groups[variantId] = {
                variantId,
                selectedIds,
                totalIds,
                displayName,
                deleteEntireVariant: false,
            }
        })

        // If forceVariantIds were provided but molecule didn't resolve any revisions,
        // build groups directly from the passed-in data (registry table scenario)
        for (const vid of forceVariantIds) {
            if (!groups[vid]) {
                groups[vid] = {
                    variantId: vid,
                    selectedIds: [...uniqueRevisionIds],
                    totalIds: [],
                    displayName: variantNameMap[vid] || vid,
                    deleteEntireVariant: true,
                }
            }
        }

        // Determine total revision count per variant and whether to delete entire variant
        Object.values(groups).forEach((group) => {
            if (group.deleteEntireVariant) return // already marked
            const allRevisions = store.get(workflowRevisionsListDataAtomFamily(group.variantId))
            const totalIds = allRevisions
                .filter(isVisibleWorkflowRevision)
                .map((r) => r.id)
                .filter(Boolean) as string[]
            group.totalIds = totalIds.length > 0 ? totalIds : group.selectedIds
            const selectedSet = new Set(group.selectedIds)
            group.deleteEntireVariant =
                forceVariantIdSet.has(group.variantId) ||
                (group.totalIds.length > 0 && group.totalIds.every((id) => selectedSet.has(id)))
        })

        return groups
    }, [forceVariantIds, resolvedRevisions, store, variantNameMap, uniqueRevisionIds])

    // Pre-check deletion validity
    useEffect(() => {
        let mounted = true
        const variantIds = Object.keys(variantGroups)
        if (variantIds.length === 0) {
            setCanDelete(false)
            setChecking(false)
            return
        }

        ;(async () => {
            try {
                const ok = await checkIfResourceValidForDeletion({
                    resourceType: "variant",
                    resourceIds: variantIds,
                })
                if (mounted) setCanDelete(ok)
            } catch (e) {
                if (mounted) setCanDelete(false)
            } finally {
                if (mounted) setChecking(false)
            }
        })()

        return () => {
            mounted = false
        }
    }, [variantGroups])

    // Build deletion plan
    const deletionPlan = useMemo(() => {
        const variantsToDel: string[] = []
        const revisions = new Set<string>()

        Object.values(variantGroups).forEach((group) => {
            if (group.deleteEntireVariant) {
                variantsToDel.push(group.variantId)
            } else {
                group.selectedIds.forEach((id) => revisions.add(id))
            }
        })

        return {variants: variantsToDel, revisions: Array.from(revisions)}
    }, [variantGroups])

    const targetVariantCount = Math.max(
        deletionPlan.variants.length,
        Object.keys(variantGroups).length,
    )
    const totalSelectedCount = uniqueRevisionIds.length
    const isBulkDelete = deletionPlan.variants.length > 0 || totalSelectedCount > 1

    // Check if this would delete the last revision of the app.
    // Count ALL visible revisions across every variant of the workflow,
    // not just the ones in variantGroups (which only covers selected items).
    const isLastRevision = useMemo(() => {
        let totalVisible = 0
        for (const variant of variants) {
            if (!variant.id) continue
            const revisions = store.get(workflowRevisionsListDataAtomFamily(variant.id))
            totalVisible += revisions.filter(isVisibleWorkflowRevision).length
        }
        return totalVisible > 0 && totalSelectedCount >= totalVisible
    }, [variants, store, totalSelectedCount])

    const onDeleteVariant = useCallback(async () => {
        setIsMutating(true)
        try {
            const currentProjectId = store.get(projectIdAtom)
            if (!currentProjectId) throw new Error("No project ID available")

            for (const variantId of deletionPlan.variants) {
                await archiveWorkflowVariant(currentProjectId, variantId)
            }

            for (const id of deletionPlan.revisions) {
                const res = await deleteRevision(id)
                if (!res?.success) {
                    throw new Error(res?.error || "Failed to delete revision")
                }
            }

            // Refresh the registry paginated store so the table updates immediately
            clearRegistryVariantNameCache()
            refreshRegistry()

            // Fire-and-forget: invalidate playground queries in the background
            // so the playground stays in sync without blocking the modal close.
            invalidatePlaygroundQueries()

            message.success(
                deletionPlan.variants.length > 0
                    ? "Deleted selected variants successfully"
                    : "Deleted selected revision(s) successfully",
            )
            onClose()
        } catch (error) {
            console.error("Failed to delete variant(s):", error)
            message.error(error instanceof Error ? error.message : "Failed to delete variant(s)")
        } finally {
            setIsMutating(false)
        }
    }, [deletionPlan, deleteRevision, invalidatePlaygroundQueries, onClose])

    // Loading state during pre-check
    if (checking) {
        return (
            <div className="flex items-center gap-3 py-6">
                <Spin />
                <Text>Checking if the selected item(s) can be deleted…</Text>
            </div>
        )
    }

    // Blocked state if not deletable
    if (canDelete === false) {
        return (
            <section className="flex flex-col gap-4">
                <Text>
                    One or more variants cannot be deleted because they are currently in use.
                </Text>
                <div className="flex items-center justify-end">
                    <Button type="primary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </section>
        )
    }

    return (
        <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <Text>
                        You are about to delete {targetVariantCount} variant
                        {targetVariantCount === 1 ? "" : "s"}
                        {deletionPlan.revisions.length > 0 &&
                            ` (${deletionPlan.revisions.length} revision${
                                deletionPlan.revisions.length === 1 ? "" : "s"
                            })`}
                        .
                    </Text>
                    <Text type="secondary">
                        Selected revisions: {totalSelectedCount}. This action cannot be undone.
                    </Text>
                </div>

                <div className="flex flex-col gap-2">
                    {Object.values(variantGroups).map((group) => (
                        <div
                            key={group.variantId}
                            className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2"
                        >
                            <div className="flex flex-col">
                                <Text strong>{group.displayName}</Text>
                                <Text type="secondary">Variant ID: {group.variantId}</Text>
                            </div>
                            <Text>
                                {group.deleteEntireVariant
                                    ? "All revisions will be removed"
                                    : `${group.selectedIds.length} of ${
                                          group.totalIds.length || group.selectedIds.length
                                      } revisions`}
                            </Text>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-end gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    type="primary"
                    danger
                    loading={isMutating}
                    disabled={isMutating || totalSelectedCount === 0 || isLastRevision}
                    icon={<Trash size={14} />}
                    onClick={onDeleteVariant}
                    title={
                        isLastRevision
                            ? "Cannot delete the only revision. Delete the app instead."
                            : undefined
                    }
                >
                    {isBulkDelete ? "Delete selected" : "Delete"}
                </Button>
            </div>
            {isLastRevision && (
                <Text type="secondary" className="text-center">
                    Cannot delete the only revision. Delete the app instead.
                </Text>
            )}
        </section>
    )
}

// ============================================================================
// MAIN CONTENT
// ============================================================================

const DeleteVariantContent = ({revisionIds, forceVariantIds = [], workflowId, onClose}: Props) => {
    const isSingleDelete =
        revisionIds.length === 1 && (!forceVariantIds || forceVariantIds.length === 0)

    if (isSingleDelete) {
        return <SingleDeleteContent revisionIds={revisionIds} onClose={onClose} />
    }

    return (
        <BulkDeleteContent
            revisionIds={revisionIds}
            forceVariantIds={forceVariantIds}
            workflowId={workflowId}
            onClose={onClose}
        />
    )
}

export default DeleteVariantContent
