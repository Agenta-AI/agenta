/**
 * SelectVariant Component
 *
 * Uses createPlaygroundSelectionAdapter(appId) for entity-level single source of truth.
 */
import {useCallback, useMemo, useState} from "react"

import {
    createLocalDraftFromRevision,
    legacyAppRevisionMolecule,
} from "@agenta/entities/legacyAppRevision"
import {isLocalDraftId} from "@agenta/entities/shared"
import {
    createLegacyAppRevisionAdapter,
    TreeSelectPopupContent,
    type LegacyAppRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {DraftTag} from "@agenta/ui/components"
import {DownOutlined} from "@ant-design/icons"
import {CopySimple, Plus, Trash} from "@phosphor-icons/react"
import {Button, Popover, Space, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {routerAppIdAtom} from "@/oss/state/app/selectors/app"

import VariantGroupTitle from "./components/VariantGroupTitle"
import {SelectVariantProps} from "./types"

const SelectVariant = ({
    value,
    showAsCompare = false,
    showCreateNew = true,
    showLatestTag = true,
    style,
    ...props
}: SelectVariantProps) => {
    const selectedVariants = useAtomValue(playgroundController.selectors.entityIds())
    const setSelectedVariants = useSetAtom(playgroundController.actions.setEntityIds)
    // Use URL-based app ID only (not localStorage fallback)
    // When null (project-level playground), adapter uses 3-level mode (App → Variant → Revision)
    // When present (app-level playground), adapter uses 2-level mode (Variant → Revision)
    const urlAppId = useAtomValue(routerAppIdAtom)
    const jotaiStore = useStore()
    const singleSelectedValue = useMemo(
        () =>
            typeof value === "string"
                ? value
                : Array.isArray(value) && typeof value[0] === "string"
                  ? value[0]
                  : null,
        [value],
    )
    const selectedRevisionData = useAtomValue(
        legacyAppRevisionMolecule.atoms.data(singleSelectedValue || ""),
    )
    const selectedRevisionQuery = useAtomValue(
        legacyAppRevisionMolecule.atoms.query(singleSelectedValue || ""),
    )
    const hasSelectedDisplayName = useMemo(() => {
        if (!singleSelectedValue) return false
        if (isLocalDraftId(singleSelectedValue)) return true
        const data = selectedRevisionData as {variantName?: string; name?: string} | null
        const name = data?.variantName ?? data?.name
        return typeof name === "string" && name.trim().length > 0
    }, [singleSelectedValue, selectedRevisionData])
    // Check if the selected revision exists by verifying its individual query
    // resolved with data — avoids reading the full app revision list on mount.
    const selectedExistsInAppList = useMemo(() => {
        if (showAsCompare) return true
        if (!singleSelectedValue) return false
        if (isLocalDraftId(singleSelectedValue)) return true
        return !selectedRevisionQuery.isError && !!selectedRevisionData
    }, [showAsCompare, singleSelectedValue, selectedRevisionQuery.isError, selectedRevisionData])

    const selectedValueForControl = useMemo(() => {
        if (showAsCompare) {
            return Array.isArray(value) ? value[0] : value
        }

        if (!singleSelectedValue) return undefined

        // Prevent raw UUID from showing only during pending resolution.
        if (
            selectedRevisionQuery.isPending &&
            !isLocalDraftId(singleSelectedValue) &&
            !hasSelectedDisplayName
        ) {
            return undefined
        }
        if (!selectedExistsInAppList) {
            return undefined
        }

        return singleSelectedValue
    }, [
        showAsCompare,
        value,
        singleSelectedValue,
        selectedRevisionQuery.isPending,
        hasSelectedDisplayName,
        selectedExistsInAppList,
    ])

    const selectPlaceholder =
        !showAsCompare &&
        !!singleSelectedValue &&
        selectedRevisionQuery.isPending &&
        !hasSelectedDisplayName
            ? "Loading variant..."
            : "Select variant"

    // Create adapter - 2-level (Variant → Revision) when app ID in URL,
    // 3-level (App → Variant → Revision) when on project-level playground
    const adapter = useMemo(
        () =>
            createLegacyAppRevisionAdapter({
                // Only pass appId when we have one from the URL
                // When null, adapter returns 3-level mode automatically
                ...(urlAppId ? {appId: urlAppId} : {}),
                includeLocalDrafts: true,
                excludeRevisionZero: true,
                variantOverrides: {
                    getLabel: (v: unknown) => {
                        const variant = v as {
                            name?: string
                            id?: string
                            isLocalDraftGroup?: boolean
                            _draftCount?: number
                        }
                        if (variant.isLocalDraftGroup) {
                            return `Local Drafts (${variant._draftCount ?? 0})`
                        }
                        return variant.name ?? variant.id ?? "Unnamed"
                    },
                },
                revisionOverrides: {
                    getLabel: (r: unknown) => {
                        const rev = r as {revision?: number; isLocalDraft?: boolean}
                        if (rev.isLocalDraft) return `Draft (v${rev.revision ?? 0})`
                        return `v${rev.revision ?? 0}`
                    },
                },
                toSelection: (path, leafEntity) => {
                    const revision = leafEntity as {
                        id: string
                        revision?: number
                        isLocalDraft?: boolean
                        variantName?: string
                        sourceRevisionId?: string
                    }
                    // In 3-level mode: path = [app, variant, revision]
                    // In 2-level mode: path = [variant, revision]
                    const isThreeLevel = path.length === 3
                    const app = isThreeLevel ? path[0] : null
                    const variant = isThreeLevel ? path[1] : path[0]
                    const resolvedAppId = app?.id ?? urlAppId ?? ""

                    return {
                        type: "legacyAppRevision",
                        id: revision.id,
                        label: revision.isLocalDraft
                            ? `Draft (${revision.variantName} v${revision.revision ?? 0})`
                            : `${variant?.label ?? "Variant"} v${revision.revision ?? 0}`,
                        path,
                        metadata: {
                            appId: resolvedAppId,
                            appName: app?.label ?? "",
                            variantId: variant?.id ?? "",
                            variantName: variant?.label ?? "",
                            revision: revision.revision ?? 0,
                            isLocalDraft: revision.isLocalDraft ?? false,
                            sourceRevisionId: revision.sourceRevisionId,
                        },
                    } as LegacyAppRevisionSelectionResult
                },
                emptyMessage: urlAppId ? "No variants found" : "No apps found",
                loadingMessage: urlAppId ? "Loading variants..." : "Loading apps...",
            }),
        [urlAppId],
    )

    // Memoize the disabled IDs set to avoid recreation on each render
    const disabledIds = useMemo(() => new Set(selectedVariants), [selectedVariants])

    // Handlers for local draft actions
    const handleCreateLocalCopy = useCallback(
        (revisionId: string, e: React.MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            const localDraftId = createLocalDraftFromRevision(revisionId)
            if (localDraftId) {
                setSelectedVariants((prev) =>
                    prev.includes(localDraftId) ? prev : [...prev, localDraftId],
                )
            }
        },
        [setSelectedVariants],
    )

    const handleDiscardLocalDraft = useCallback(
        (localDraftId: string, e: React.MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            setSelectedVariants((prev) => prev.filter((id) => id !== localDraftId))
            legacyAppRevisionMolecule.set.discard(localDraftId)
        },
        [setSelectedVariants],
    )

    // Handle selection from EntityPicker
    const handleSelect = useCallback(
        (selection: LegacyAppRevisionSelectionResult) => {
            if (showAsCompare) {
                // Compare mode: ADD the selected revision to the displayed list
                // Don't add if already in the list (disabledIds check should prevent this, but be safe)
                if (!selectedVariants.includes(selection.id)) {
                    setSelectedVariants((prev) => [...prev, selection.id])
                }
            } else if (props.onChange) {
                // Normal mode: REPLACE the current revision with the selected one
                props.onChange(selection.id, [], {
                    triggerValue: selection.id,
                    triggerNode: {props: {value: selection.id}},
                } as any)
            }
        },
        [showAsCompare, selectedVariants, setSelectedVariants, props],
    )

    // Custom parent title renderer (variant groups)
    const renderParentTitle = useCallback((parent: unknown, defaultNode: React.ReactNode) => {
        const p = parent as {
            id?: string
            variantId?: string
            isLocalDraftGroup?: boolean
            variantName?: string
            name?: string
        }
        return <VariantGroupTitle parent={p} defaultNode={defaultNode} />
    }, [])

    // Custom child title renderer (revisions)
    const renderChildTitle = useCallback(
        (child: unknown, _parent: unknown, _defaultNode: React.ReactNode) => {
            const c = child as {
                id: string
                isLocalDraft?: boolean
                isDirty?: boolean
                variantName?: string
                revision?: number
            }
            const isDisabled = disabledIds.has(c.id)

            if (c.isLocalDraft) {
                return (
                    <div
                        className={`flex items-center justify-between h-[32px] pl-1.5 pr-0 group/draft ${isDisabled ? "opacity-50" : ""}`}
                    >
                        <div className="flex items-center gap-2">
                            <Typography.Text>v{c.revision}</Typography.Text>
                            <DraftTag />
                            {c.isDirty && (
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                            )}
                        </div>
                        <Tooltip title="Discard draft">
                            <Button
                                type="text"
                                size="small"
                                danger
                                icon={<Trash size={14} />}
                                className="opacity-0 group-hover/draft:opacity-100 transition-opacity"
                                onClick={(e) => handleDiscardLocalDraft(c.id, e)}
                            />
                        </Tooltip>
                    </div>
                )
            }

            return (
                <div
                    className={`flex items-center justify-between h-[32px] pl-1.5 pr-0 group/revision ${isDisabled ? "opacity-50" : ""}`}
                >
                    <VariantDetailsWithStatus
                        className="w-full [&_.environment-badges]:mr-2"
                        variantName={c.variantName ?? ""}
                        revision={c.revision ?? 0}
                        variant={c as any}
                        hideName
                        showBadges
                        showLatestTag={showLatestTag}
                        isLatest={
                            c.id ===
                            jotaiStore.get(legacyAppRevisionMolecule.atoms.latestRevisionId)
                        }
                    />
                    {showAsCompare && (
                        <Tooltip title="Create local copy for comparison">
                            <Button
                                type="text"
                                size="small"
                                icon={<CopySimple size={14} />}
                                className="opacity-0 group-hover/revision:opacity-100 transition-opacity mr-1"
                                onClick={(e) => handleCreateLocalCopy(c.id, e)}
                                data-tour="compare-toggle"
                            />
                        </Tooltip>
                    )}
                </div>
            )
        },
        [
            showLatestTag,
            showAsCompare,
            handleCreateLocalCopy,
            handleDiscardLocalDraft,
            disabledIds,
            jotaiStore,
        ],
    )

    const renderSelectedLabel = useCallback(
        (child: unknown, parent: unknown, _defaultNode: React.ReactNode) => {
            const c = child as {id: string; variantName?: string}
            const p = parent as {variantName?: string; name?: string}
            const variantName = c.variantName ?? p?.variantName ?? p?.name ?? ""

            // Only show variant name inside the selector
            // Revision number and draft/dirty indicators are rendered outside by PlaygroundVariantConfigHeader
            return variantName
        },
        [],
    )

    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    // Handle compare button click - create local copy of last (rightmost) visible revision
    const handleCompareButtonClick = useCallback(() => {
        // Get the last visible revision ID from value prop (rightmost in compare mode)
        const lastRevisionId = Array.isArray(value) ? value[value.length - 1] : value

        if (lastRevisionId) {
            const localDraftId = createLocalDraftFromRevision(lastRevisionId)

            if (localDraftId) {
                setSelectedVariants((prev) =>
                    prev.includes(localDraftId) ? prev : [...prev, localDraftId],
                )
                recordWidgetEvent("playground_compared_side_by_side")
            }
        }
    }, [value, setSelectedVariants, recordWidgetEvent])

    // Compare mode: Split button with tree popup content in popover
    const [comparePopoverOpen, setComparePopoverOpen] = useState(false)

    // Single-select mode state — must be declared before the early return
    // so hooks are always called in the same order.
    const [singlePopoverOpen, setSinglePopoverOpen] = useState(false)

    const handleSingleSelect = useCallback(
        (result: LegacyAppRevisionSelectionResult) => {
            handleSelect(result)
            setSinglePopoverOpen(false)
        },
        [handleSelect],
    )

    // Build display label from already-fetched individual revision data.
    // Uses singleSelectedValue directly (not selectedValueForControl which
    // may be undefined while the existence check resolves).
    const triggerLabel = useMemo(() => {
        if (!singleSelectedValue) return selectPlaceholder
        if (isLocalDraftId(singleSelectedValue)) return "Draft"
        if (selectedRevisionQuery.isPending) return "Loading..."
        const data = selectedRevisionData as {
            variantName?: string
            configName?: string
        } | null
        return data?.variantName ?? data?.configName ?? selectPlaceholder
    }, [
        singleSelectedValue,
        selectedRevisionData,
        selectedRevisionQuery.isPending,
        selectPlaceholder,
    ])

    if (showAsCompare) {
        return (
            <Space.Compact size="small">
                <Button
                    className="flex items-center gap-1"
                    icon={<Plus size={14} />}
                    onClick={handleCompareButtonClick}
                    data-tour="compare-toggle"
                >
                    Compare
                </Button>
                <Popover
                    content={
                        <TreeSelectPopupContent<LegacyAppRevisionSelectionResult>
                            adapter={adapter}
                            onSelect={handleSelect}
                            selectedValue={selectedValueForControl}
                            disabledChildIds={disabledIds}
                            renderParentTitle={renderParentTitle}
                            renderChildTitle={renderChildTitle}
                            renderSelectedLabel={renderSelectedLabel}
                            maxHeight={400}
                            width={280}
                        />
                    }
                    open={comparePopoverOpen}
                    onOpenChange={setComparePopoverOpen}
                    trigger="click"
                    placement="bottomRight"
                    arrow={false}
                    destroyOnHidden
                    styles={{body: {padding: 0}}}
                >
                    <Button icon={<DownOutlined style={{fontSize: 10}} />} />
                </Popover>
            </Space.Compact>
        )
    }

    // Normal mode: Popover + trigger so TreeSelectPopupContent only mounts
    // when the user clicks — prevents fetching all variants on mount.
    return (
        <div style={style ?? {width: 120}}>
            <Popover
                content={
                    <div>
                        {singlePopoverOpen && (
                            <TreeSelectPopupContent<LegacyAppRevisionSelectionResult>
                                adapter={adapter}
                                onSelect={handleSingleSelect}
                                selectedValue={selectedValueForControl}
                                disabledChildIds={disabledIds}
                                renderParentTitle={renderParentTitle}
                                renderChildTitle={renderChildTitle}
                                renderSelectedLabel={renderSelectedLabel}
                                maxHeight={400}
                                width={280}
                            />
                        )}
                    </div>
                }
                open={singlePopoverOpen}
                onOpenChange={setSinglePopoverOpen}
                trigger="click"
                placement="bottomLeft"
                arrow={false}
                destroyOnHidden
                styles={{body: {padding: 0}}}
            >
                <Button
                    size="small"
                    className="w-full flex items-center justify-between text-left overflow-hidden"
                >
                    <span className="truncate text-xs">{triggerLabel}</span>
                    <DownOutlined style={{fontSize: 10, marginLeft: 4, flexShrink: 0}} />
                </Button>
            </Popover>
        </div>
    )
}

export default SelectVariant
