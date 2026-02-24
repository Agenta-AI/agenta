import {EntityPicker, testsetAdapter, type TestsetSelectionResult} from "@agenta/entity-ui"
import {layoutSizes, spacingClasses} from "@agenta/ui/styles"

import {CreateTestsetCard} from "./CreateTestsetCard"

export interface TestsetSelectionSidebarProps {
    /** Currently selected revision ID */
    selectedRevisionId: string | null
    /** Currently selected testset ID */
    selectedTestsetId: string | null
    /** Callback when a testset/revision is selected */
    onSelect: (revisionId: string, testsetId: string) => void
    /** Optional disabled child IDs (e.g., currently connected revision) */
    disabledChildIds?: Set<string>
    /** Whether to show the create card */
    showCreateCard?: boolean
    /** Callback for file upload via create card */
    onCreateFileUpload?: (file: File) => void
    /** Callback for build in UI via create card */
    onCreateBuildInUI?: () => void
}

export function TestsetSelectionSidebar({
    selectedRevisionId,
    selectedTestsetId,
    onSelect,
    disabledChildIds,
    showCreateCard = false,
    onCreateFileUpload,
    onCreateBuildInUI,
}: TestsetSelectionSidebarProps) {
    return (
        <div
            className={`flex flex-col overflow-auto ${spacingClasses.panel}`}
            style={{
                width: layoutSizes.sidebarWide,
                flexShrink: 0,
            }}
        >
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

            {showCreateCard && (
                <CreateTestsetCard
                    onFileUpload={onCreateFileUpload}
                    onBuildInUI={onCreateBuildInUI}
                />
            )}
        </div>
    )
}
