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

import {useCallback, useMemo, type ReactNode} from "react"

import {
    loadMoreTestcasesAtom,
    testcaseMolecule as testcase,
    testcaseDataController,
    type Column,
    type TestcaseDataConfig,
    type TestcaseTableRow,
} from "@agenta/entities/testcase"
import {CellContentPopover, SmartCellContent, TextCellContent} from "@agenta/ui/cell-renderers"
import {
    ColumnVisibilityMenuTrigger,
    useRowHeightContext,
    type ColumnDefs,
    type RowHeightFeatureConfig,
    type TypeChipConfig,
} from "@agenta/ui/table"
import {useAtomValue, useSetAtom} from "jotai"

import {EntityTable, type EntityColumnHeader} from "../shared"

// ============================================================================
// TYPES
// ============================================================================

export interface TestcaseTableProps {
    /**
     * Data source configuration. An edit session sets `includeNewRows`, so rows added locally
     * and not yet saved show in the table.
     */
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
    /** Whether export actions should be enabled */
    canExportData?: boolean
    /**
     * Called when a row is clicked. A row click then no longer toggles selection; the
     * checkbox still does.
     */
    onRowClick?: (row: TestcaseTableRow) => void
    /** Extra columns appended after the data columns, for example a row menu */
    appendColumns?: ColumnDefs<TestcaseTableRow>
    /** Replaces each column and group header, for per-column actions */
    renderColumnHeader?: (header: EntityColumnHeader) => ReactNode
    /** Extra controls in the toolbar, next to the settings button */
    headerExtra?: ReactNode

    // Editor features. Each is off by default, so a picker or preview renders as before.
    /**
     * Puts the table settings button (column visibility, row height) in the header of the last
     * appended column, or of a small column of its own. Cells then follow the row height.
     */
    columnSettings?: boolean
    /** Shows the full value of a cell, with a Copy button, when the pointer rests on it */
    cellPopover?: boolean
    /**
     * Marks each row with unsaved edits, and each new row, on its left edge. Needs `selectable`:
     * the marker sits in the selection cell.
     */
    markEditedRows?: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default row height configuration for testcase tables */
const DEFAULT_ROW_HEIGHT_CONFIG: RowHeightFeatureConfig = {
    storageKey: "agenta:testcase-table:row-height",
    defaultSize: "medium",
}

function getNativeColumnValue(
    record: Record<string, unknown> | null | undefined,
    columnKey: string,
): unknown {
    if (!record) return undefined

    const directValue = record[columnKey]
    if (directValue !== undefined) return directValue

    const parts = columnKey.split(".")
    if (parts.length === 1) return undefined

    let current: unknown = record

    for (const part of parts) {
        if (current === null || current === undefined) return undefined

        if (Array.isArray(current)) {
            const index = Number(part)
            if (!Number.isInteger(index) || String(index) !== part) return undefined
            current = current[index]
            continue
        }

        if (typeof current !== "object") return undefined

        current = (current as Record<string, unknown>)[part]
    }

    return current
}

const SETTINGS_COLUMN_WIDTH = 48

/**
 * A cell value that follows the row height: the chosen size caps the cell's height and lines.
 * A string gets the hover popover with Copy when asked for; other values get it from
 * `SmartCellContent`.
 */
function TestcaseCellValue({value, popover}: {value: unknown; popover: boolean}) {
    const {maxLines, heightPx} = useRowHeightContext()
    const capped = (content: ReactNode) => (
        <div className="overflow-hidden" style={{maxHeight: heightPx}}>
            {content}
        </div>
    )
    if (typeof value !== "string") {
        return capped(<SmartCellContent value={value} showPopover={popover} />)
    }
    const content = capped(<TextCellContent value={value} maxLines={maxLines} />)
    if (!popover || value === "") return content
    return (
        <CellContentPopover
            fullContent={<TextCellContent value={value} truncate={false} />}
            copyText={value}
        >
            <div className="cursor-pointer">{content}</div>
        </CellContentPopover>
    )
}

/** The left-edge marker of a row with unsaved edits, or of a new row. */
function EditedRowMarker({row}: {row: TestcaseTableRow}) {
    const draft = useAtomValue(testcase.atoms.draft(row.id))
    if (!row.__isNew && !draft) return null
    return (
        <span
            className="pointer-events-none absolute inset-0 border-0 border-l-[3px] border-solid border-colorWarning bg-colorWarningBg"
            title="Unsaved changes"
        >
            <span className="sr-only">Unsaved changes</span>
        </span>
    )
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
    canExportData = true,
    onRowClick,
    appendColumns,
    renderColumnHeader,
    headerExtra,
    columnSettings = false,
    cellPopover = false,
    markEditedRows = false,
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

    const getTypeChipValue = useCallback((record: TestcaseTableRow, columnKey: string): unknown => {
        const entity = testcase.get.data(record.id)
        return getNativeColumnValue(entity?.data, columnKey)
    }, [])

    // Without the editor features a cell renders exactly as before.
    const editorCells = columnSettings || cellPopover
    const renderCell = useCallback(
        (value: unknown) => {
            if (editorCells) return <TestcaseCellValue value={value} popover={cellPopover} />
            if (typeof value === "string") {
                return <TextCellContent value={value} />
            }

            return <SmartCellContent value={value} />
        },
        [cellPopover, editorCells],
    )

    // The settings button sits in the header of the last appended column. The appended
    // columns hold row controls, so the column picker does not list them.
    const trailingColumns = useMemo<ColumnDefs<TestcaseTableRow> | undefined>(() => {
        if (!columnSettings) return appendColumns
        const trigger = <ColumnVisibilityMenuTrigger variant="icon" />
        const locked = {columnVisibilityLocked: true}
        if (!appendColumns || appendColumns.length === 0) {
            return [
                {
                    key: "__settings",
                    title: trigger,
                    width: SETTINGS_COLUMN_WIDTH,
                    fixed: "right",
                    render: () => null,
                    ...locked,
                },
            ]
        }
        const last = appendColumns.length - 1
        return appendColumns.map((column, index) => {
            if (index !== last) return {...column, ...locked}
            const title = typeof column.title === "function" ? column.title({}) : column.title
            return {
                ...column,
                ...locked,
                title: (
                    <div className="flex items-center justify-end gap-1">
                        {title}
                        {trigger}
                    </div>
                ),
            }
        })
    }, [appendColumns, columnSettings])

    const renderSelectionMarker = useCallback(
        (row: TestcaseTableRow) => <EditedRowMarker row={row} />,
        [],
    )

    // Share chip visibility pref with OSS TestcasesTableShell so toggling
    // chips off in one surface (eg. main testsets page) hides them in all
    // testcase tables consistently.
    const typeChips = useMemo<TypeChipConfig<TestcaseTableRow>>(
        () => ({
            defaultEnabled: true,
            storageKey: "agenta:testcase-table:type-chips-enabled",
            getRowValue: getTypeChipValue,
        }),
        [getTypeChipValue],
    )

    // A server table loads later pages as the reader scrolls; a local one has one page.
    const loadMore = useSetAtom(loadMoreTestcasesAtom)
    const loadNextPage = useCallback(() => loadMore(config), [config, loadMore])

    return (
        <EntityTable<TestcaseTableRow, TestcaseDataConfig, Column>
            controller={testcaseDataController}
            config={config}
            getRowData={getRowData}
            getCellValue={getCellValue}
            selectable={selectable}
            selectedIds={selectedIds}
            onSelectionChange={onSelectionChange}
            onRowClick={onRowClick}
            multiSelect={multiSelect}
            selectionDisabled={selectionDisabled}
            grouping
            rowHeightConfig={rowHeightConfig}
            showSettings={showSettings}
            enableExport={canExportData}
            appendColumns={trailingColumns}
            renderSelectionMarker={markEditedRows ? renderSelectionMarker : undefined}
            renderColumnHeader={renderColumnHeader}
            headerExtra={headerExtra}
            loadNextPage={config.useLocal ? undefined : loadNextPage}
            typeChips={typeChips}
            renderCell={renderCell}
            emptyMessage="No testcases found"
        />
    )
}
