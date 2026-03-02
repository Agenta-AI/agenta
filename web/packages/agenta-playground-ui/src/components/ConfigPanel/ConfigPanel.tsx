/**
 * ConfigPanel Component
 *
 * Left panel of the playground that displays runnable configuration.
 * Mirrors the "Prompt" panel in the current playground design.
 *
 * Features:
 * - Entity header with variant info and commit button
 * - Configuration drill-in (prompt messages, model config)
 * - Combined Inputs & Data section showing expected inputs and data sources
 * - Outputs section with output receivers management
 *
 * Architecture:
 * - Composed of focused sub-components for each section
 * - Sub-components read state from controllers/atoms where appropriate
 * - Props are passed for testset-related state (from PlaygroundContent's loadable)
 */

import {memo, useMemo} from "react"

import {
    runnableBridge,
    type TestsetColumn,
    type InputMapping,
    type RunnableType,
} from "@agenta/entities/runnable"
import {useAtomValue} from "jotai"

import {ConfigurationSection} from "../ConfigurationSection"
import type {EntitySelection} from "../EntitySelector"

import {
    ConfigPanelHeader,
    InputsDataSection,
    DataSourceSection,
    DownstreamMappingsSection,
    type OutputReceiverInfo,
} from "./components"

// Re-export OutputReceiverInfo for external use
export type {OutputReceiverInfo}

export interface ConfigPanelProps {
    /** The selected entity */
    entity: EntitySelection
    /** Callback to remove the entity */
    onRemove: () => void
    /** Callback to change the entity */
    onChange?: () => void
    /** Expected input columns (from runnable's schema) */
    columns: TestsetColumn[]
    /** Supplied input columns (from testset/testcase data) */
    suppliedColumns?: {key: string; name: string}[]
    /** Connected testset name (for display) */
    connectedTestsetName?: string
    /** Connected testset ID - if set, it's a remote testset; if null/undefined with name, it's local */
    connectedTestsetId?: string | null
    /** Callback to open testset connection modal */
    onConnectTestset?: () => void
    /** Navigate to connected testset */
    onNavigateToTestset?: () => void
    /** Disconnect from testset */
    onDisconnectTestset?: () => void
    /** Number of displayed testcases (visible rows) */
    localTestcaseCount?: number
    /** Total number of testcases (including hidden) */
    totalTestcaseCount?: number
    /** Callback to save local testcases as a new testset */
    onSaveAsTestset?: () => void
    /** Whether there are uncommitted local changes to the connected testset */
    hasLocalChanges?: boolean
    /** Callback to commit local changes to connected testset as new revision */
    onCommitChanges?: () => void | Promise<void>
    /** Whether commit is in progress */
    isCommitting?: boolean
    /** Callback to discard local changes */
    onDiscardChanges?: () => void
    /** Callback to edit testcase selection (modify which testcases are included) */
    onEditSelection?: () => void
    /** Connected output receivers (downstream runnables) */
    outputReceivers?: OutputReceiverInfo[]
    /** Callback to add a new output receiver */
    onAddOutputReceiver?: () => void
    /** Callback to edit an output receiver's mappings */
    onEditOutputReceiver?: (connectionId: string) => void
    /** Callback to remove an output receiver */
    onRemoveOutputReceiver?: (connectionId: string) => void
    /** Callback to navigate to an output receiver's config */
    onNavigateToReceiver?: (entityId: string) => void
    /** Whether this is a downstream node (depth > 0) - hides testset connection UI */
    isDownstream?: boolean
    /** Extra columns added by the user (beyond runnable input vars) */
    extraColumns?: {key: string; name: string; type: string}[]
    /** Callback to add a new extra column */
    onAddExtraColumn?: (name: string) => void
    /** Callback to remove an extra column */
    onRemoveExtraColumn?: (key: string) => void
    /** Column keys that are newly added (from prompt template but not in original testcase data) */
    newColumnKeys?: string[]
    /** Input mappings for downstream nodes (shows where inputs come from) */
    incomingMappings?: InputMapping[]
    /** Source entity label for downstream nodes */
    sourceEntityLabel?: string
    /** Callback to open the mapping editor */
    onEditMappings?: () => void
    /** Loadable ID for output mapping (primary node only) */
    loadableId?: string
    /** Whether to show the output mappings section (primary node only) */
    showOutputMappings?: boolean
    /** Callback to add output mapping column (only adds to testcase data, not to extraColumns) */
    onAddOutputMappingColumn?: (name: string) => void
}

/**
 * ConfigPanel - Left panel for runnable configuration
 *
 * Composed of focused sub-components:
 * - ConfigPanelHeader: Entity info, version badge, commit/change/remove buttons
 * - ConfigurationSection: DrillIn for prompt/model configuration
 * - InputsDataSection: Expected vs Provided inputs, extra columns
 * - DataSourceSection: Remote/local testset connection (primary nodes only)
 * - DownstreamMappingsSection: Input mappings (downstream nodes only)
 * - OutputsSection: Output schema and receivers
 *
 * Wrapped with React.memo to prevent unnecessary re-renders when parent
 * re-renders but props haven't changed. This is important for performance
 * when sibling components (e.g., TestcasePanel) update frequently during execution.
 */
export const ConfigPanel = memo(function ConfigPanel({
    entity,
    onRemove,
    onChange,
    columns,
    suppliedColumns = [],
    connectedTestsetName,
    connectedTestsetId,
    onConnectTestset,
    onNavigateToTestset,
    onDisconnectTestset,
    localTestcaseCount = 0,
    totalTestcaseCount,
    onSaveAsTestset,
    hasLocalChanges = false,
    onCommitChanges,
    isCommitting = false,
    onDiscardChanges,
    onEditSelection,
    outputReceivers = [],
    onAddOutputReceiver,
    onEditOutputReceiver,
    onRemoveOutputReceiver,
    onNavigateToReceiver,
    isDownstream = false,
    extraColumns = [],
    onAddExtraColumn,
    onRemoveExtraColumn,
    newColumnKeys = [],
    incomingMappings = [],
    sourceEntityLabel,
    onEditMappings,
    loadableId,
    showOutputMappings = false,
    onAddOutputMappingColumn,
}: ConfigPanelProps) {
    const type = entity.type as RunnableType

    // Use bridge selectors for runnable data access
    const dataAtom = useMemo(() => runnableBridge.data(entity.id), [entity.id])
    const data = useAtomValue(dataAtom)

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <ConfigPanelHeader entity={entity} onRemove={onRemove} onChange={onChange} />

            {/* Configuration Content */}
            <div className="flex-1 overflow-y-auto">
                {/* DrillIn Configuration */}
                <div className="px-4 py-4">
                    <ConfigurationSection type={type} entityId={entity.id} data={data} />
                </div>

                {/* Combined Inputs & Data Section */}
                <InputsDataSection
                    entity={entity}
                    columns={columns}
                    suppliedColumns={suppliedColumns}
                    isDownstream={isDownstream}
                    extraColumns={extraColumns}
                    newColumnKeys={newColumnKeys}
                    onAddExtraColumn={onAddExtraColumn}
                    onAddOutputMappingColumn={onAddOutputMappingColumn}
                    onRemoveExtraColumn={onRemoveExtraColumn}
                    loadableId={loadableId}
                    showOutputMappings={showOutputMappings}
                >
                    {/* Data Source - Only shown for primary nodes (not downstream) */}
                    {!isDownstream && (
                        <DataSourceSection
                            connectedTestsetName={connectedTestsetName}
                            connectedTestsetId={connectedTestsetId}
                            onConnectTestset={onConnectTestset}
                            onNavigateToTestset={onNavigateToTestset}
                            onDisconnectTestset={onDisconnectTestset}
                            localTestcaseCount={localTestcaseCount}
                            totalTestcaseCount={totalTestcaseCount}
                            onSaveAsTestset={onSaveAsTestset}
                            hasLocalChanges={hasLocalChanges}
                            onCommitChanges={onCommitChanges}
                            isCommitting={isCommitting}
                            onDiscardChanges={onDiscardChanges}
                            onEditSelection={onEditSelection}
                        />
                    )}

                    {/* Downstream Input Source Info */}
                    {isDownstream && (
                        <DownstreamMappingsSection
                            entity={entity}
                            columns={columns}
                            incomingMappings={incomingMappings}
                            sourceEntityLabel={sourceEntityLabel}
                            onEditMappings={onEditMappings}
                        />
                    )}
                </InputsDataSection>

                {/* NOTE: OutputsSection is disabled - output receiver management is now
                   handled via DownstreamMappingsSection for downstream nodes and
                   the RunnableColumnsLayout for multi-node chains. The output mapping
                   functionality has been moved to OutputMappingSection within InputsDataSection. */}
            </div>
        </div>
    )
})
