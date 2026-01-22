/**
 * TestsetPicker Component
 *
 * A reusable component for browsing and selecting testsets and their revisions.
 * Uses EntityListWithPopover with testsetAdapter for hierarchical navigation.
 *
 * **Prerequisites:** The selection system must be initialized before using this component.
 * Call `initializeSelectionSystem({ testset: testsetSelectionConfig })` in your app's
 * initialization (e.g., Providers.tsx).
 *
 * @example
 * ```typescript
 * // In Providers.tsx or app initialization:
 * import { initializeSelectionSystem } from '@agenta/entities/ui'
 * import { testsetSelectionConfig } from '@agenta/entities/testset'
 *
 * initializeSelectionSystem({ testset: testsetSelectionConfig })
 *
 * // Then use the component:
 * import { TestsetPicker } from '@agenta/entities/ui'
 *
 * <TestsetPicker
 *   selectedRevisionId={selectedRevisionId}
 *   selectedTestsetId={selectedTestsetId}
 *   onSelect={(revisionId, testsetId) => handleSelect(revisionId, testsetId)}
 * />
 * ```
 */

import {useCallback} from "react"

import {EntityListWithPopover, testsetAdapter, type TestsetSelectionResult} from "../selection"

// ============================================================================
// TYPES
// ============================================================================

export interface TestsetPickerProps {
    /** Currently selected revision ID */
    selectedRevisionId: string | null
    /** Currently selected testset ID (for visual indicator) */
    selectedTestsetId?: string | null
    /** Callback when a revision is selected */
    onSelect: (revisionId: string, testsetId: string) => void
    /** Revision IDs that should be disabled (grayed out, not selectable) */
    disabledRevisionIds?: Set<string>
    /** Tooltip to show on disabled revisions */
    disabledRevisionTooltip?: string
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TestsetPicker({
    selectedRevisionId,
    selectedTestsetId,
    onSelect,
    disabledRevisionIds,
    disabledRevisionTooltip,
}: TestsetPickerProps) {
    // Handle selection from EntityListWithPopover
    const handleSelect = useCallback(
        (selection: TestsetSelectionResult) => {
            // EntityListWithPopover returns the full selection result with metadata
            // We extract the revision ID and testset ID
            onSelect(selection.metadata.revisionId, selection.metadata.testsetId)
        },
        [onSelect],
    )

    // Wrapper ensures full height layout since EntityListWithPopover doesn't provide its own container
    return (
        <div className="flex flex-col h-full">
            <EntityListWithPopover<TestsetSelectionResult>
                adapter={testsetAdapter}
                onSelect={handleSelect}
                selectedParentId={selectedTestsetId}
                selectedChildId={selectedRevisionId}
                showSearch
                emptyMessage="No testsets found"
                popoverPlacement="rightTop"
                autoSelectLatest
                selectLatestOnParentClick
                disabledChildIds={disabledRevisionIds}
                disabledChildTooltip={disabledRevisionTooltip}
            />
        </div>
    )
}
