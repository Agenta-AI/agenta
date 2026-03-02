import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    legacyAppRevisionMolecule,
    revisionsListWithDraftsAtomFamily,
    variantsListWithDraftsAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {EntityNameWithVersion} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {Trash} from "@phosphor-icons/react"
import {Button, Spin, Typography} from "antd"
import {atom, getDefaultStore, useAtomValue, useSetAtom} from "jotai"

import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {deleteSingleVariant} from "@/oss/services/playground/api"

const {Text} = Typography

interface Props {
    revisionIds: string[]
    forceVariantIds?: string[]
    onClose: () => void
}

interface VariantGroup {
    variantId: string
    selectedIds: string[]
    totalIds: string[]
    displayName: string
    deleteEntireVariant: boolean
}

const isVisibleServerRevision = (revision: any) => {
    if (!revision?.id) return false
    if (revision?.isLocalDraft) return false
    return Number(revision?.revision ?? 0) > 0
}

// Stable empty atom for when no entity ID is available
const emptyWorkflowDataAtom = atom(() => null)

// ============================================================================
// WORKFLOW DELETE CONTENT
// ============================================================================

/**
 * Simplified delete content for workflow entities.
 * Workflows use the archive API via playgroundController.actions.deleteRevision
 * rather than the legacy variant deletion flow.
 */
const WorkflowDeleteContent = ({
    revisionIds,
    onClose,
}: {
    revisionIds: string[]
    onClose: () => void
}) => {
    const deleteRevision = useSetAtom(playgroundController.actions.deleteRevision)
    const [isMutating, setIsMutating] = useState(false)

    const entityId = revisionIds[0]

    // Memoize the data atom to get the proper entity data with version info
    const dataAtom = useMemo(
        () => (entityId ? workflowMolecule.selectors.data(entityId) : null),
        [entityId],
    )

    // Read workflow entity data
    const workflowData = useAtomValue(dataAtom ?? emptyWorkflowDataAtom)

    // Extract name and version for display
    const entityName = workflowData?.name || workflowData?.slug || "this workflow"
    const entityVersion = workflowData?.version

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
            <div className="flex flex-col gap-1">
                <Text>
                    You are about to delete{" "}
                    <EntityNameWithVersion name={entityName} version={entityVersion} />. This action
                    cannot be undone.
                </Text>
            </div>

            <div className="flex items-center justify-end gap-2">
                <Button onClick={onClose}>Cancel</Button>
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
            </div>
        </section>
    )
}

// ============================================================================
// LEGACY DELETE CONTENT
// ============================================================================

const LegacyDeleteContent = ({revisionIds, forceVariantIds = [], onClose}: Props) => {
    const store = getDefaultStore()
    const deleteRevision = useSetAtom(playgroundController.actions.deleteRevision)
    const invalidatePlaygroundQueries = useSetAtom(playgroundController.actions.invalidateQueries)

    const [checking, setChecking] = useState(true)
    const [canDelete, setCanDelete] = useState<boolean | null>(null)
    const [isMutating, setIsMutating] = useState(false)

    // Derive appId from the first revision's data (entity-scoped, not global)
    const firstRevisionData = useMemo(() => {
        const firstId = revisionIds[0]
        if (!firstId) return null
        return store.get(legacyAppRevisionMolecule.atoms.data(firstId)) as {appId?: string} | null
    }, [revisionIds, store])
    const appId = firstRevisionData?.appId ?? null

    const emptyListAtom = useMemo(
        () => atom({data: [], isPending: false, isError: false, error: null}),
        [],
    )
    const variantsListAtom = useMemo(
        () => (appId ? variantsListWithDraftsAtomFamily(appId) : emptyListAtom),
        [appId, emptyListAtom],
    )
    const variantsQuery = useAtomValue(variantsListAtom)
    const variants = variantsQuery.data ?? []

    const uniqueRevisionIds = useMemo(
        () => Array.from(new Set([revisionIds].flat().filter(Boolean))) as string[],
        [revisionIds],
    )

    const resolvedRevisions = useMemo(
        () =>
            uniqueRevisionIds
                // Use molecule-backed variant for single source of truth
                .map((id) => store.get(legacyAppRevisionMolecule.atoms.data(id)))
                .filter(Boolean) as any[],
        [store, uniqueRevisionIds],
    )

    const variantNameMap = useMemo(() => {
        const map: Record<string, string> = {}
        variants.forEach((variant: any) => {
            if (!variant?.id) return
            map[variant.id] = (variant.name as string) || (variant.baseName as string) || variant.id
        })
        return map
    }, [variants])

    const variantGroups = useMemo(() => {
        const groups: Record<string, VariantGroup> = {}
        const forceVariantIdSet = new Set(forceVariantIds)

        resolvedRevisions.forEach((rev: any) => {
            const variantId = (rev?._parentVariant as string) || (rev?.variantId as string)
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

        Object.values(groups).forEach((group) => {
            const allRevisions = (store.get(revisionsListWithDraftsAtomFamily(group.variantId))
                ?.data || []) as any[]
            const totalIds = allRevisions
                .filter(isVisibleServerRevision)
                .map((r: any) => r.id)
                .filter(Boolean) as string[]
            group.totalIds = totalIds.length > 0 ? totalIds : group.selectedIds
            const selectedSet = new Set(group.selectedIds)
            group.deleteEntireVariant =
                forceVariantIdSet.has(group.variantId) ||
                (group.totalIds.length > 0 && group.totalIds.every((id) => selectedSet.has(id)))
        })

        return groups
    }, [forceVariantIds, resolvedRevisions, store, variantNameMap])

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

    const deletionPlan = useMemo(() => {
        const variants: string[] = []
        const revisions = new Set<string>()

        Object.values(variantGroups).forEach((group) => {
            if (group.deleteEntireVariant) {
                variants.push(group.variantId)
            } else {
                group.selectedIds.forEach((id) => revisions.add(id))
            }
        })

        return {variants, revisions: Array.from(revisions)}
    }, [variantGroups])

    const targetVariantCount = Math.max(
        deletionPlan.variants.length,
        Object.keys(variantGroups).length,
    )
    const totalSelectedCount = uniqueRevisionIds.length
    const isBulkDelete = deletionPlan.variants.length > 0 || totalSelectedCount > 1

    const onDeleteVariant = useCallback(async () => {
        setIsMutating(true)
        try {
            for (const variantId of deletionPlan.variants) {
                await deleteSingleVariant(variantId)
            }

            for (const id of deletionPlan.revisions) {
                const res = await deleteRevision(id)
                if (!res?.success) {
                    throw new Error(res?.error || "Failed to delete revision")
                }
            }

            // Always invalidate all related queries so registry and playground stay in sync.
            await invalidatePlaygroundQueries()

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
                    disabled={isMutating || totalSelectedCount === 0}
                    icon={<Trash size={14} />}
                    onClick={onDeleteVariant}
                >
                    {isBulkDelete ? "Delete selected" : "Delete"}
                </Button>
            </div>
        </section>
    )
}

// ============================================================================
// MAIN CONTENT (Routes to workflow or legacy)
// ============================================================================

const nodesAtom = playgroundController.selectors.nodes()

const DeleteVariantContent = ({revisionIds, forceVariantIds = [], onClose}: Props) => {
    const nodes = useAtomValue(nodesAtom)
    const isWorkflowRef = useRef<boolean | null>(null)

    if (isWorkflowRef.current === null) {
        const idSet = new Set(revisionIds)
        const hasWorkflowNode = nodes.some(
            (n) => idSet.has(n.entityId) && n.entityType === "workflow",
        )
        const hasWorkflowEntity = revisionIds.some((id) => Boolean(workflowMolecule.get.data(id)))
        isWorkflowRef.current = hasWorkflowNode || hasWorkflowEntity
    }

    const isWorkflow = isWorkflowRef.current

    if (isWorkflow) {
        return <WorkflowDeleteContent revisionIds={revisionIds} onClose={onClose} />
    }

    return (
        <LegacyDeleteContent
            revisionIds={revisionIds}
            forceVariantIds={forceVariantIds}
            onClose={onClose}
        />
    )
}

export default DeleteVariantContent
