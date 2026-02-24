import {EntityPicker, testsetAdapter, type TestsetSelectionResult} from "@agenta/entity-ui"
import {layoutSizes} from "@agenta/ui/styles"

import type {CreateCardRenderProps} from "../types"

export interface TestsetSelectionSidebarProps {
    /** Currently selected revision ID */
    selectedRevisionId: string | null
    /** Currently selected testset ID */
    selectedTestsetId: string | null
    /** Callback when a testset/revision is selected */
    onSelect: (revisionId: string, testsetId: string) => void
    /** Optional disabled child IDs (e.g., currently connected revision) */
    disabledChildIds?: Set<string>
    /** Optional slot to render the create card (e.g., file upload/build in UI) */
    renderCreateCard?: (props: CreateCardRenderProps) => React.ReactNode
    /** Callback when "Build in UI" is clicked */
    onBuildInUI?: () => void
    /** Whether the modal is in create mode */
    isCreateMode?: boolean
    /** Exit create mode */
    onExitCreateMode?: () => void
    /** Current testset name value */
    newTestsetName?: string
    /** Callback when testset name changes */
    onTestsetNameChange?: (name: string) => void
    /** Current commit message value */
    newTestsetCommitMessage?: string
    /** Callback when commit message changes */
    onCommitMessageChange?: (message: string) => void
}

export function TestsetSelectionSidebar({
    selectedRevisionId,
    selectedTestsetId,
    onSelect,
    disabledChildIds,
    renderCreateCard,
    onBuildInUI,
    isCreateMode = false,
    onExitCreateMode,
    newTestsetName = "",
    onTestsetNameChange,
    newTestsetCommitMessage = "",
    onCommitMessageChange,
}: TestsetSelectionSidebarProps) {
    return (
        <div
            className={`flex flex-col justify-between overflow-auto`}
            style={{
                width: layoutSizes.sidebarWide,
                flexShrink: 0,
            }}
        >
            {/* Hide entity picker when in create mode, like the old modal */}
            {!isCreateMode && (
                <EntityPicker<TestsetSelectionResult>
                    variant="list-popover"
                    adapter={testsetAdapter}
                    onSelect={(selection) =>
                        onSelect(selection.metadata.revisionId, selection.metadata.testsetId)
                    }
                    selectedParentId={selectedTestsetId}
                    selectedChildId={selectedRevisionId}
                    showSearch
                    sectionLabel="Test sets"
                    emptyMessage="No testsets found"
                    popoverPlacement="rightTop"
                    autoSelectLatest
                    selectLatestOnParentClick
                    maxHeight={220}
                    disabledChildIds={disabledChildIds}
                    disabledChildTooltip="Already connected"
                />
            )}

            {renderCreateCard?.({
                onTestsetCreated: (revisionId, testsetId) => {
                    onSelect(revisionId, testsetId)
                },
                onBuildInUI: () => onBuildInUI?.(),
                isCreateMode,
                onExitCreateMode: () => onExitCreateMode?.(),
                newTestsetName,
                onTestsetNameChange: (name) => onTestsetNameChange?.(name),
                newTestsetCommitMessage,
                onCommitMessageChange: (msg) => onCommitMessageChange?.(msg),
            })}
        </div>
    )
}
