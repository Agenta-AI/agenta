/**
 * SelectVariant Component
 *
 * Uses createWorkflowRevisionAdapter for workflow-based variant/revision selection.
 * Lists variants and revisions via the workflow API (/preview/workflows/*).
 *
 * Supports two modes:
 * - "scoped" (default): 2-level (Variant → Revision), scoped to the current app
 * - "browse": 3-level (Workflow → Variant → Revision), shows all workflows (apps + evaluators)
 */
import {useCallback, useMemo, useState} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {
    CascadingVariant,
    createWorkflowRevisionAdapter,
    TreeSelectPopupContent,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {DownOutlined} from "@ant-design/icons"
import {CopySimple, Plus} from "@phosphor-icons/react"
import {Button, Popover, Space, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {selectedAppIdAtom} from "@/oss/state/app"

import RevisionChildTitle from "./components/RevisionChildTitle"
import VariantGroupTitle from "./components/VariantGroupTitle"
import {SelectVariantProps} from "./types"

const SelectVariant = ({
    value,
    showAsCompare = false,
    showCreateNew = true,
    showLatestTag = true,
    mode = "scoped",
    style,
    ...props
}: SelectVariantProps) => {
    const selectedVariants = useAtomValue(playgroundController.selectors.entityIds())
    const setSelectedVariants = useSetAtom(playgroundController.actions.setEntityIds)
    const selectedAppId = useAtomValue(selectedAppIdAtom)
    const appId = selectedAppId ?? ""
    const singleSelectedValue = useMemo(
        () =>
            typeof value === "string"
                ? value
                : Array.isArray(value) && typeof value[0] === "string"
                  ? value[0]
                  : null,
        [value],
    )
    const selectedRevisionData = useAtomValue(runnableBridge.data(singleSelectedValue || ""))
    const selectedRevisionQuery = useAtomValue(runnableBridge.query(singleSelectedValue || ""))
    const hasSelectedDisplayName = useMemo(() => {
        if (!singleSelectedValue) return false
        if (isLocalDraftId(singleSelectedValue)) return true
        const name = selectedRevisionData?.name
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

    // Scoped adapter: 2-level (Variant → Revision), scoped to the current app
    const scopedAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                workflowIdAtom: selectedAppIdAtom,
                workflowId: appId,
                excludeRevisionZero: true,
                variantOverrides: {
                    getLabel: (v: unknown) => {
                        const variant = v as {name?: string; id?: string}
                        return variant.name ?? variant.id ?? "Unnamed"
                    },
                },
                revisionOverrides: {
                    getLabel: (r: unknown) => {
                        const rev = r as {version?: number}
                        return `v${rev.version ?? 0}`
                    },
                },
                toSelection: (path, leafEntity) => {
                    const revision = leafEntity as {
                        id: string
                        version?: number
                    }
                    const variant = path[0]

                    return {
                        type: "workflowRevision",
                        id: revision.id,
                        label: `${variant?.label ?? "Variant"} v${revision.version ?? 0}`,
                        path,
                        metadata: {
                            workflowId: appId,
                            workflowName: "",
                            variantId: variant?.id ?? "",
                            variantName: variant?.label ?? "",
                            revision: revision.version ?? 0,
                        },
                    }
                },
                emptyMessage: "No variants found",
                loadingMessage: "Loading variants...",
            }),
        [appId],
    )

    // Browse adapter: 3-level (Workflow → Variant → Revision), all workflows
    const browseAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                excludeRevisionZero: true,
            }),
        [],
    )

    // Memoize the disabled IDs set to avoid recreation on each render
    const disabledIds = useMemo(() => new Set(selectedVariants), [selectedVariants])

    // Handlers for local draft actions
    const handleCreateLocalCopy = useCallback(
        (revisionId: string, e: React.MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            const localDraftId = runnableBridge.createLocalDraft(revisionId)
            if (localDraftId) {
                setSelectedVariants((prev) =>
                    prev.includes(localDraftId) ? prev : [...prev, localDraftId],
                )
            }
        },
        [setSelectedVariants],
    )

    // Handle selection from EntityPicker
    const handleSelect = useCallback(
        (selection: WorkflowRevisionSelectionResult) => {
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
                version?: number
                name?: string
                variantName?: string
            }

            return (
                <RevisionChildTitle
                    revisionId={c.id}
                    variantName={c.variantName ?? c.name ?? ""}
                    version={c.version ?? 0}
                    variant={c}
                    isDisabled={disabledIds.has(c.id)}
                    showLatestTag={showLatestTag}
                    showAsCompare={showAsCompare}
                    onCreateLocalCopy={handleCreateLocalCopy}
                />
            )
        },
        [showLatestTag, showAsCompare, handleCreateLocalCopy, disabledIds],
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
            const localDraftId = runnableBridge.createLocalDraft(lastRevisionId)

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
        (result: WorkflowRevisionSelectionResult) => {
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
        if (isLocalDraftId(singleSelectedValue)) {
            return selectedRevisionData?.name ?? "Draft"
        }
        if (selectedRevisionQuery.isPending) return "Loading..."
        return selectedRevisionData?.name ?? selectPlaceholder
    }, [
        singleSelectedValue,
        selectedRevisionData,
        selectedRevisionQuery.isPending,
        selectPlaceholder,
    ])

    // Handle browse mode selection — wraps handleSelect to also close the popover
    const handleBrowseSelect = useCallback(
        (selection: WorkflowRevisionSelectionResult) => {
            handleSelect(selection)
            setSinglePopoverOpen(false)
        },
        [handleSelect],
    )

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
                        <TreeSelectPopupContent<WorkflowRevisionSelectionResult>
                            adapter={scopedAdapter}
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

    // Browse mode: cascading dropdowns (Workflow → Variant → Revision) inside a Popover
    if (mode === "browse") {
        return (
            <div style={style ?? {width: 160}}>
                <Popover
                    content={
                        <div className="p-3 w-[320px]">
                            {singlePopoverOpen && (
                                <CascadingVariant<WorkflowRevisionSelectionResult>
                                    adapter={browseAdapter}
                                    onSelect={handleBrowseSelect}
                                    showLabels
                                    layout="vertical"
                                    size="small"
                                    gap={2}
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

    // Scoped mode (default): Popover + trigger so TreeSelectPopupContent only mounts
    // when the user clicks — prevents fetching all variants on mount.
    return (
        <div style={style ?? {width: 120}}>
            <Popover
                content={
                    <div>
                        {singlePopoverOpen && (
                            <TreeSelectPopupContent<WorkflowRevisionSelectionResult>
                                adapter={scopedAdapter}
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
