/**
 * TestcaseTable Component
 *
 * A thin wrapper over `EntityTable` for displaying testcases with optional selection support.
 * Uses testcaseDataController for unified data access.
 *
 * @example
 * ```typescript
 * // View-only mode (no selection)
 * import { TestcaseTable } from '@agenta/entity-ui'
 *
 * <TestcaseTable
 *   config={{ scopeId: 'my-table', revisionId: 'rev-123' }}
 * />
 *
 * // With selection
 * <TestcaseTable
 *   config={{ scopeId: 'my-table', revisionId: 'rev-123' }}
 *   selectable
 *   onSelectionChange={(ids) => console.log('Selected:', ids)}
 * />
 * ```
 */

import {useCallback} from "react"

import {testcase} from "@agenta/entities"
import {
    testcaseDataController,
    type Column,
    type TestcaseDataConfig,
    type TestcaseTableRow,
} from "@agenta/entities/testcase"
import type {RowHeightFeatureConfig} from "@agenta/ui/table"

import {EntityTable} from "../shared"

// ============================================================================
// TYPES
// ============================================================================

export interface TestcaseTableProps {
    /** Data source configuration */
    config: TestcaseDataConfig
    /** Enable row selection (default: false) */
    selectable?: boolean
    /**
     * Externally controlled selection state.
     * When provided, selection is controlled externally instead of via testcaseDataController.
     */
    selectedIds?: string[]
    /** Callback when selection changes (only used when selectable=true) */
    onSelectionChange?: (ids: string[]) => void
    /** Whether to allow multiple selection (default: true, only used when selectable=true) */
    multiSelect?: boolean
    /** Whether selection is disabled (grayed out but visible, only used when selectable=true) */
    selectionDisabled?: boolean
    /** Custom row height config */
    rowHeightConfig?: RowHeightFeatureConfig
    /** Whether to show settings dropdown */
    showSettings?: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default row height configuration for testcase tables */
const DEFAULT_ROW_HEIGHT_CONFIG: RowHeightFeatureConfig = {
    storageKey: "agenta:testcase-table:row-height",
    defaultSize: "medium",
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TestcaseTable({
    config,
    selectable = false,
    selectedIds,
    onSelectionChange,
    multiSelect = true,
    selectionDisabled = false,
    rowHeightConfig = DEFAULT_ROW_HEIGHT_CONFIG,
    showSettings = true,
}: TestcaseTableProps) {
    // Testcase-specific row data resolver:
    // All rows (identity-only) look up data from the entity's .data property.
    // Note: This is a fallback - getCellValue is the primary accessor.
    const getRowData = useCallback((record: TestcaseTableRow): Record<string, unknown> | null => {
        const entity = testcase.get.data(record.id)
        return entity?.data ?? null
    }, [])

    // Cell-level accessor for fine-grained value retrieval.
    // Uses testcaseCellAtomFamily which reads from entity.data[columnKey].
    const getCellValue = useCallback((record: TestcaseTableRow, columnKey: string): unknown => {
        return testcase.get.cell(record.id, columnKey)
    }, [])

    return (
        <EntityTable<TestcaseTableRow, TestcaseDataConfig, Column>
            controller={testcaseDataController}
            config={config}
            getRowData={getRowData}
            getCellValue={getCellValue}
            selectable={selectable}
            selectedIds={selectedIds}
            onSelectionChange={onSelectionChange}
            multiSelect={multiSelect}
            selectionDisabled={selectionDisabled}
            grouping
            rowHeightConfig={rowHeightConfig}
            showSettings={showSettings}
            emptyMessage="No testcases found"
        />
    )
}
