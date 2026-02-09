/**
 * SelectVariant Component
 *
 * WP-7.1: Migrated to use EntityPicker pattern with playgroundSelectionAdapter.
 * WP-7.2: Updated to use playgroundVariantMetaMapAtom for metadata (replaces optionsSelectors).
 * Uses createPlaygroundSelectionAdapter(appId) for entity-level single source of truth.
 */
import {useCallback, useMemo} from "react"

import {EntityPicker, TreeSelectPopupContent} from "@agenta/entity-ui/selection"
import {DraftTag} from "@agenta/ui/components"
import {DownOutlined} from "@ant-design/icons"
import {CopySimple, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Button, Popover, Space, Tooltip, Typography} from "antd"
import {getDefaultStore} from "jotai"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import EnvironmentStatus from "@/oss/components/VariantDetailsWithStatus/components/EnvironmentStatus"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {currentAppAtom} from "@/oss/state/app"
import {
    cloneAsLocalDraft,
    discardRevisionDraftAtom,
    playgroundVariantMetaMapAtom,
} from "@/oss/state/newPlayground/legacyEntityBridge"

import {selectedVariantsAtom, parametersOverrideAtomFamily} from "../../../state/atoms"
import {playgroundLatestAppRevisionIdAtom} from "../../../state/atoms/playgroundAppAtoms"
import {
    createPlaygroundSelectionAdapter,
    type PlaygroundRevisionSelectionResult,
} from "../../../state/atoms/playgroundSelectionAdapter"

import {SelectVariantProps} from "./types"

const SelectVariant = ({
    value,
    showAsCompare = false,
    showCreateNew = true,
    showLatestTag = true,
    style,
    ...props
}: SelectVariantProps) => {
    const [selectedVariants, setSelectedVariants] = useAtom(selectedVariantsAtom)
    const currentApp = useAtomValue(currentAppAtom)
    const appId = currentApp && !(currentApp instanceof Promise) ? currentApp.app_id : ""

    // Get metadata map for custom rendering (replaces variantOptionsAtomFamily)
    const metaMap = useAtomValue(playgroundVariantMetaMapAtom)
    const latestAppRevisionId = useAtomValue(playgroundLatestAppRevisionIdAtom)

    // Create adapter scoped to current app (memoized)
    const adapter = useMemo(() => createPlaygroundSelectionAdapter(appId), [appId])

    // Memoize the disabled IDs set to avoid recreation on each render
    const disabledIds = useMemo(() => new Set(selectedVariants), [selectedVariants])

    // Handlers for local draft actions
    const handleCreateLocalCopy = useCallback(
        (revisionId: string, e: React.MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            const localDraftId = cloneAsLocalDraft(revisionId)
            if (localDraftId) {
                setSelectedVariants((prev) =>
                    prev.includes(localDraftId) ? prev : [...prev, localDraftId],
                )
            }
        },
        [setSelectedVariants],
    )

    const discardDraft = useSetAtom(discardRevisionDraftAtom)

    const handleDiscardLocalDraft = useCallback(
        (localDraftId: string, e: React.MouseEvent) => {
            e.stopPropagation()
            e.preventDefault()
            setSelectedVariants((prev) => prev.filter((id) => id !== localDraftId))
            discardDraft(localDraftId)
            getDefaultStore().set(parametersOverrideAtomFamily(localDraftId), null)
        },
        [setSelectedVariants, discardDraft],
    )

    // Handle selection from EntityPicker
    const handleSelect = useCallback(
        (selection: PlaygroundRevisionSelectionResult) => {
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
    const renderParentTitle = useCallback(
        (parent: unknown, defaultNode: React.ReactNode) => {
            const p = parent as {
                id?: string
                variantId?: string
                isLocalDraftGroup?: boolean
                variantName?: string
                name?: string
            }
            const parentId = p.variantId ?? p.id ?? ""
            const variantMeta = metaMap.variants.get(parentId)

            if (p.isLocalDraftGroup) {
                return (
                    <div className="flex items-center justify-between pr-0 grow">
                        <div className="flex items-center gap-1.5">
                            <PencilSimpleLine size={14} className="text-[#9254de]" />
                            <Typography.Text className="font-medium text-[#9254de]">
                                {defaultNode ?? p.variantName ?? p.name ?? "Local Drafts"}
                            </Typography.Text>
                        </div>
                    </div>
                )
            }

            return (
                <div className="flex items-center justify-between pr-0 grow">
                    <Typography.Text ellipsis={{tooltip: p.variantName ?? p.name}}>
                        {defaultNode ?? p.variantName ?? p.name}
                    </Typography.Text>
                    <EnvironmentStatus
                        className="mr-2"
                        variant={{
                            deployedIn: (variantMeta?.deployedIn ?? []) as any,
                        }}
                    />
                </div>
            )
        },
        [metaMap],
    )

    // Custom child title renderer (revisions)
    const renderChildTitle = useCallback(
        (child: unknown, parent: unknown, defaultNode: React.ReactNode, ...rest) => {
            const c = child as {
                id: string
                isLocalDraft?: boolean
                isDirty?: boolean
                variantName?: string
                revision?: number
            }
            const revisionMeta = metaMap.revisions.get(c.id)
            const isDisabled = disabledIds.has(c.id)

            if (c.isLocalDraft || revisionMeta?.isLocalDraft) {
                return (
                    <div
                        className={`flex items-center justify-between h-[32px] pl-1.5 pr-0 group/draft ${isDisabled ? "opacity-50" : ""}`}
                    >
                        <div className="flex items-center gap-2">
                            <Typography.Text>
                                v{c.revision ?? revisionMeta?.revision}
                            </Typography.Text>
                            <DraftTag />
                            {(c.isDirty || revisionMeta?.isDirty) && (
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
                        variantName={c.variantName ?? revisionMeta?.variantName ?? ""}
                        revision={c.revision ?? revisionMeta?.revision ?? 0}
                        variant={revisionMeta?.variant as any}
                        hideName
                        showBadges
                        showLatestTag={showLatestTag}
                        isLatest={c.id === latestAppRevisionId}
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
            metaMap,
            showLatestTag,
            showAsCompare,
            handleCreateLocalCopy,
            handleDiscardLocalDraft,
            disabledIds,
            latestAppRevisionId,
        ],
    )

    const renderSelectedLabel = useCallback(
        (child: unknown, parent: unknown, _defaultNode: React.ReactNode) => {
            const c = child as {
                id: string
                variantName?: string
            }
            const p = parent as {variantName?: string; name?: string}
            const revisionMeta = metaMap.revisions.get(c.id)
            const variantName =
                c.variantName ?? revisionMeta?.variantName ?? p?.variantName ?? p?.name ?? ""

            // Only show variant name inside the selector
            // Revision number and draft/dirty indicators are rendered outside by PlaygroundVariantConfigHeader
            return variantName
        },
        [metaMap],
    )

    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    // Handle compare button click - create local copy of last (rightmost) visible revision
    const handleCompareButtonClick = useCallback(() => {
        // Get the last visible revision ID from value prop (rightmost in compare mode)
        const lastRevisionId = Array.isArray(value) ? value[value.length - 1] : value

        if (lastRevisionId) {
            const localDraftId = cloneAsLocalDraft(lastRevisionId)

            if (localDraftId) {
                setSelectedVariants((prev) =>
                    prev.includes(localDraftId) ? prev : [...prev, localDraftId],
                )
                recordWidgetEvent("playground_compared_side_by_side")
            }
        }
    }, [value, setSelectedVariants, recordWidgetEvent])

    // Compare mode: Split button with tree popup content in popover
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
                        <TreeSelectPopupContent<PlaygroundRevisionSelectionResult>
                            adapter={adapter}
                            onSelect={handleSelect}
                            selectedValue={Array.isArray(value) ? value[0] : value}
                            disabledChildIds={disabledIds}
                            renderParentTitle={renderParentTitle}
                            renderChildTitle={renderChildTitle}
                            renderSelectedLabel={renderSelectedLabel}
                            maxHeight={400}
                            width={280}
                        />
                    }
                    trigger="click"
                    placement="bottomRight"
                    arrow={false}
                    styles={{body: {padding: 0}}}
                >
                    <Button icon={<DownOutlined style={{fontSize: 10}} />} />
                </Popover>
            </Space.Compact>
        )
    }

    // Normal mode: standard picker
    return (
        <div style={style ?? {width: 120}}>
            <EntityPicker<PlaygroundRevisionSelectionResult>
                variant="tree-select"
                adapter={adapter}
                onSelect={handleSelect}
                selectedValue={Array.isArray(value) ? value[0] : value}
                disabledChildIds={disabledIds}
                renderParentTitle={renderParentTitle}
                renderChildTitle={renderChildTitle}
                renderSelectedLabel={renderSelectedLabel}
                popupHeaderAction={null}
                size="small"
                placeholder="Select variant"
                popupMinWidth={280}
                maxHeight={400}
            />
        </div>
    )
}

export default SelectVariant
