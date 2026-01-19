/**
 * ConfigurationSection Component
 *
 * Displays the configuration for a runnable entity using EntityDrillInView.
 * Supports both app revisions and evaluators.
 * Renders the DrillIn breadcrumb integrated into the collapse header.
 *
 * Uses the unified useRunnable hook for state management.
 * Uses context injection for EntityDrillInView component.
 */

import {useState, useMemo, useCallback} from "react"

import {appRevisionMolecule} from "@agenta/entities/appRevision"
import {evaluatorRevisionMolecule} from "@agenta/entities/evaluatorRevision"
import {
    getRunnableRootItems,
    useRunnableSelectors,
    useRunnableActions,
    useRunnable,
    type RunnableType,
    type RunnableData,
    type SettingsPreset,
} from "@agenta/entities/runnable"
import {
    GearSix,
    CaretDown,
    CaretUp,
    CaretRight,
    ArrowCounterClockwise,
    ListBullets,
} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {usePlaygroundUI} from "../../context"
import {LoadEvaluatorPresetModal} from "../LoadEvaluatorPresetModal"

const {Text} = Typography

export interface ConfigurationSectionProps {
    type: RunnableType
    entityId: string
    data: RunnableData | null
}

export function ConfigurationSection({type, entityId, data}: ConfigurationSectionProps) {
    // Get injectable components from context
    const {EntityDrillInView} = usePlaygroundUI()

    const [isExpanded, setIsExpanded] = useState(false)
    const [isPresetModalOpen, setIsPresetModalOpen] = useState(false)

    // Controlled path state for the DrillIn view
    const [currentPath, setCurrentPath] = useState<string[]>([])

    // Use the unified runnable hook for state management
    const runnable = useRunnable(type, entityId)

    // Get selectors and actions from context
    const runnableSelectors = useRunnableSelectors()
    const runnableActions = useRunnableActions()

    // Get drillIn root items for navigation
    const rootItems = useMemo(() => {
        return getRunnableRootItems(type, data)
    }, [type, data])

    // Get the appropriate entity controller based on type (needed for DrillInView)
    const entityController = useMemo(() => {
        if (type === "appRevision") {
            return appRevisionMolecule
        } else if (type === "evaluatorRevision") {
            return evaluatorRevisionMolecule
        }
        return null
    }, [type])

    // Get available presets via unified runnable API
    // Returns empty array for appRevisions, presets for evaluators (if available)
    const presetsAtom = useMemo(
        () => runnableSelectors.presets(type, entityId),
        [runnableSelectors, type, entityId],
    )
    const presets = useAtomValue(presetsAtom)

    // Apply preset via unified runnable API (dispatches to previewEvaluator for evaluators)
    const applyPreset = useSetAtom(runnableActions.applyPreset)
    const handleApplyPreset = useCallback(
        (preset: SettingsPreset) => {
            applyPreset({revisionId: entityId, preset})
        },
        [applyPreset, entityId],
    )

    // Handle revert using the hook
    const handleRevert = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            runnable.discard()
        },
        [runnable],
    )

    // Navigation callback for breadcrumb
    const navigateToIndex = useCallback((index: number) => {
        setCurrentPath((prev) => prev.slice(0, index))
    }, [])

    if (!data) {
        return null
    }

    const rootTitle = "Configuration"
    const isAtRoot = currentPath.length === 0

    return (
        <div className="border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
            {/* Header with collapse toggle - integrates breadcrumb when navigated */}
            <div
                className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white cursor-pointer"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-1 flex-1 min-w-0">
                    <GearSix size={14} className="flex-shrink-0 text-gray-500" />

                    {/* Always show Configuration as clickable root */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            navigateToIndex(0)
                        }}
                        className={`px-1 py-0.5 rounded hover:bg-gray-100 transition-colors bg-transparent border-none cursor-pointer whitespace-nowrap flex-shrink-0 text-sm ${isAtRoot ? "font-semibold text-gray-900" : "text-gray-500"}`}
                    >
                        {rootTitle}
                    </button>

                    {/* Show section count only at root */}
                    {isAtRoot && (
                        <span className="text-gray-400 text-xs">({rootItems.length} sections)</span>
                    )}

                    {/* Show path segments when navigated */}
                    {!isAtRoot && (
                        <div
                            className="flex items-center gap-1 flex-1 min-w-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {currentPath.map((segment, index) => (
                                <div key={index} className="flex items-center flex-shrink-0">
                                    <CaretRight size={12} className="text-gray-400" />
                                    <button
                                        type="button"
                                        onClick={() => navigateToIndex(index + 1)}
                                        className={`px-1 py-0.5 rounded hover:bg-gray-100 transition-colors bg-transparent border-none cursor-pointer whitespace-nowrap text-sm ${index === currentPath.length - 1 ? "font-semibold text-gray-900" : "text-gray-500"}`}
                                    >
                                        {segment}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Dirty badge - inline with breadcrumbs */}
                    {runnable.isDirty && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium ml-2 flex-shrink-0">
                            edited
                        </span>
                    )}
                </div>

                <div
                    className="flex items-center gap-1 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Load Preset button - shows when presets available (evaluators only for now) */}
                    {presets.length > 0 && (
                        <Tooltip title="Load preset">
                            <Button
                                size="small"
                                type="text"
                                icon={<ListBullets size={14} />}
                                onClick={() => setIsPresetModalOpen(true)}
                            />
                        </Tooltip>
                    )}
                    {/* Revert button - inline with header controls */}
                    {runnable.isDirty && (
                        <Tooltip title="Revert changes">
                            <Button
                                size="small"
                                type="text"
                                icon={<ArrowCounterClockwise size={14} />}
                                onClick={handleRevert}
                            />
                        </Tooltip>
                    )}
                    {isExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                </div>
            </div>

            {isExpanded && (
                <div className="px-3 py-2">
                    {!entityController ? (
                        <Text type="secondary" italic>
                            No configuration available
                        </Text>
                    ) : (
                        <EntityDrillInView
                            entityId={entityId}
                            entity={entityController as any}
                            editable={true}
                            showAddControls={false}
                            showDeleteControls={false}
                            rootTitle={rootTitle}
                            showCollapse={false}
                            hideBreadcrumb={true}
                            currentPath={currentPath}
                            onPathChange={setCurrentPath}
                        />
                    )}
                </div>
            )}

            {/* Load Preset Modal - shown when presets available */}
            {presets.length > 0 && (
                <LoadEvaluatorPresetModal
                    open={isPresetModalOpen}
                    onCancel={() => setIsPresetModalOpen(false)}
                    presets={presets}
                    onApply={handleApplyPreset}
                />
            )}
        </div>
    )
}
