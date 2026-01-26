/**
 * TestcasePanel Component
 *
 * Right panel of the playground that handles testcase execution.
 * Mirrors the "Generations" panel in the current playground design.
 *
 * This panel is purely for EXECUTION context:
 * - Displays testcase data (loaded from connected sources or manually added)
 * - Run buttons for individual and batch execution
 * - Output display for each testcase (including chain results)
 *
 * Note: Data source connections (testset linking) belong in ConfigPanel,
 * not here. This panel only consumes the loaded data.
 */

import {memo, useCallback, useMemo, useState} from "react"

import type {TestsetColumn, TestsetRow} from "@agenta/entities/runnable"
import {cn, textColors, bgColors, borderColors} from "@agenta/ui/styles"
import {Lightning, Plus} from "@phosphor-icons/react"
import {Button, Empty, Tag, Typography} from "antd"

import {usePlaygroundUI} from "../../context"
import type {ChainExecutionResult, ChainNodeInfo} from "../types"

import {TestcaseRow} from "./components"

const {Text} = Typography

export interface TestcasePanelProps {
    /** Loadable ID for testcase management */
    loadableId: string
    /** Column definitions (from linked runnable's inputSchema) - EXPECTED inputs */
    columns: TestsetColumn[]
    /** All columns from the testset data - PROVIDED inputs (may include extra fields) */
    suppliedColumns?: {key: string; name: string}[]
    /** All testcase rows */
    rows: TestsetRow[]
    /** Execution results per row (may include chain results) */
    executionResults: Record<string, ChainExecutionResult>
    /** Add a new row */
    onAddRow: (data?: Record<string, unknown>) => void
    /** Update a row's data */
    onUpdateRow: (rowId: string, data: Record<string, unknown>) => void
    /** Remove a row */
    onRemoveRow: (rowId: string) => void
    /** Clear all rows */
    onClearRows: () => void
    /** Execute a single row */
    onExecuteRow: (rowId: string, data: Record<string, unknown>) => void
    /** Execute all rows */
    onExecuteAll?: () => void
    /** Whether execution is in progress */
    isExecuting?: boolean
    /** Chain node info for displaying downstream results */
    chainNodes?: ChainNodeInfo[]
    /** Revert output mapping overrides for a row */
    onRevertOverrides?: (rowId: string) => void
}

/**
 * TestcasePanel - Right panel for testcase execution
 *
 * This is purely execution context - data source connections
 * are managed in the ConfigPanel.
 *
 * Wrapped with React.memo to prevent unnecessary re-renders when parent
 * re-renders but props haven't changed. This is important for performance
 * when sibling components update.
 */
export const TestcasePanel = memo(function TestcasePanel({
    loadableId,
    columns,
    suppliedColumns = [],
    rows,
    executionResults,
    onAddRow,
    onUpdateRow,
    onRemoveRow,
    onClearRows,
    onExecuteRow,
    onExecuteAll,
    isExecuting,
    chainNodes,
    onRevertOverrides,
}: TestcasePanelProps) {
    // Get injectable components from context
    const {SharedGenerationResultUtils} = usePlaygroundUI()

    // Global toggle state for all rows
    const [globalShowExtras, setGlobalShowExtras] = useState(false)
    // Key that increments when global toggle is clicked (to reset local overrides)
    const [globalToggleKey, setGlobalToggleKey] = useState(0)
    const hasRows = rows.length > 0

    // Check if any results are from chain execution
    const hasChainResults = Object.values(executionResults).some((r) => r.isChain)

    // Compute extra columns (in supplied but not in expected)
    const extraColumns = useMemo(() => {
        const expectedKeys = new Set(columns.map((c) => c.key.toLowerCase()))
        return suppliedColumns.filter((c) => !expectedKeys.has(c.key.toLowerCase()))
    }, [columns, suppliedColumns])

    const hasExtraColumns = extraColumns.length > 0

    // Handler for global toggle - resets all local overrides
    const handleGlobalToggle = useCallback(() => {
        setGlobalShowExtras((prev) => !prev)
        setGlobalToggleKey((prev) => prev + 1)
    }, [])

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header - Execution controls only */}
            <div
                className={cn(
                    "px-4 py-3 border-b flex items-center gap-2 sticky top-0 z-10",
                    borderColors.secondary,
                    bgColors.container,
                )}
            >
                <Text strong className="text-base">
                    Generations
                </Text>
                {hasChainResults && (
                    <Tag color="blue" className="m-0">
                        Chain
                    </Tag>
                )}
                <div className="flex items-center gap-2 ml-auto">
                    {/* Global toggle for showing all extra variables */}
                    {hasExtraColumns && hasRows && (
                        <Button
                            size="small"
                            type={globalShowExtras ? "primary" : "default"}
                            onClick={handleGlobalToggle}
                            title={
                                globalShowExtras
                                    ? "Collapse all extra data"
                                    : "Expand all extra data"
                            }
                        >
                            {globalShowExtras ? "Collapse all" : "Expand all"}
                        </Button>
                    )}
                    {hasRows && (
                        <Button size="small" onClick={onClearRows}>
                            Clear
                        </Button>
                    )}
                    {onExecuteAll && hasRows && (
                        <Button
                            type="primary"
                            size="small"
                            icon={<Lightning size={14} weight="fill" />}
                            onClick={onExecuteAll}
                            loading={isExecuting}
                            disabled={columns.length === 0}
                        >
                            Run all
                        </Button>
                    )}
                </div>
            </div>

            {/* Testcase List */}
            <div className="flex-1 overflow-y-auto p-4">
                {!hasRows ? (
                    <div className="h-full flex items-center justify-center">
                        <Empty
                            description={
                                <span className={textColors.tertiary}>
                                    No testcases yet.
                                    <br />
                                    Connect a testset or add testcases manually.
                                </span>
                            }
                        >
                            <Button
                                type="primary"
                                icon={<Plus size={14} />}
                                onClick={() => onAddRow()}
                            >
                                Add Testcase
                            </Button>
                        </Empty>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {rows.map((row) => (
                            <TestcaseRow
                                key={row.id}
                                loadableId={loadableId}
                                row={row}
                                columns={columns}
                                extraColumns={extraColumns}
                                globalShowExtras={globalShowExtras}
                                globalToggleKey={globalToggleKey}
                                executionResult={executionResults[row.id]}
                                chainNodes={chainNodes}
                                onUpdate={(data) => onUpdateRow(row.id, data)}
                                onRemove={() => onRemoveRow(row.id)}
                                onExecute={() => onExecuteRow(row.id, row.data)}
                                onRevertOverrides={
                                    onRevertOverrides ? () => onRevertOverrides(row.id) : undefined
                                }
                                SharedGenerationResultUtils={SharedGenerationResultUtils}
                            />
                        ))}

                        {/* Add Testcase Button */}
                        <Button
                            type="dashed"
                            icon={<Plus size={14} />}
                            onClick={() => onAddRow()}
                            className="w-full"
                        >
                            Testcase
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
})
