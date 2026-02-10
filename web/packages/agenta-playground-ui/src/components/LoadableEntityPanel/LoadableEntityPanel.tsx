/**
 * LoadableEntityPanel Component
 *
 * Main panel for displaying and managing loadable entities (testsets).
 * Provides a unified interface for:
 * - Viewing and editing rows (testcases)
 * - Connecting to data sources
 * - Executing rows against runnables
 *
 * @example
 * ```tsx
 * <LoadableEntityPanel
 *     loadableId={testsetId}
 *     columns={columns}
 *     onExecuteRow={(rowId) => runnable.execute(getRowData(rowId))}
 *     onExecuteAll={() => runnable.executeAll()}
 * />
 * ```
 */

import {useCallback, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import type {TestsetColumn} from "@agenta/entities/runnable"
import {Database, Lightning, Link, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {Button, Card, Empty, Space, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {LoadableRowCard} from "./LoadableRowCard"

const {Text} = Typography

export interface LoadableEntityPanelProps {
    /** Unique ID for this loadable instance */
    loadableId: string
    /** Column definitions for the rows */
    columns: TestsetColumn[]
    /** Title to display */
    title?: string
    /** Callback when a row should be executed */
    onExecuteRow?: (rowId: string, data: Record<string, unknown>) => void
    /** Callback when all rows should be executed */
    onExecuteAll?: () => void
    /** Callback when panel should be removed */
    onRemove?: () => void
    /** Whether to show the load/change testset button */
    showConnect?: boolean
    /** Callback when load/change testset is clicked */
    onConnect?: () => void
    /** Name of the connected source (testset name) */
    connectedSourceName?: string
    /** Callback when connected source tag is clicked (navigate to testset) */
    onNavigateToSource?: () => void
    /** Callback when disconnected from source */
    onDisconnect?: () => void
}

export function LoadableEntityPanel({
    loadableId,
    columns,
    title = "Testcases",
    onExecuteRow,
    onExecuteAll,
    onRemove,
    showConnect = false,
    onConnect,
    connectedSourceName,
    onNavigateToSource,
    onDisconnect,
}: LoadableEntityPanelProps) {
    // ========================================================================
    // SELECTORS (memoized atoms per agenta-package-practices)
    // ========================================================================
    const rowsAtom = useMemo(() => loadableController.selectors.rows(loadableId), [loadableId])
    const modeAtom = useMemo(() => loadableController.selectors.mode(loadableId), [loadableId])
    const rowCountAtom = useMemo(
        () => loadableController.selectors.rowCount(loadableId),
        [loadableId],
    )
    const activeRowAtom = useMemo(
        () => loadableController.selectors.activeRow(loadableId),
        [loadableId],
    )
    const executionResultsAtom = useMemo(
        () => loadableController.selectors.executionResults(loadableId),
        [loadableId],
    )

    // Subscribe to state
    const rows = useAtomValue(rowsAtom)
    const mode = useAtomValue(modeAtom)
    const rowCount = useAtomValue(rowCountAtom)
    const activeRowId = useAtomValue(activeRowAtom)
    const executionResults = useAtomValue(executionResultsAtom)

    // ========================================================================
    // ACTIONS (memoized setters)
    // ========================================================================
    const addRowAction = useSetAtom(loadableController.actions.addRow)
    const updateRowAction = useSetAtom(loadableController.actions.updateRow)
    const removeRowAction = useSetAtom(loadableController.actions.removeRow)
    const setActiveRowAction = useSetAtom(loadableController.actions.setActiveRow)
    const clearRowsAction = useSetAtom(loadableController.actions.clearRows)
    const disconnectAction = useSetAtom(loadableController.actions.disconnect)

    // ========================================================================
    // DERIVED STATE
    // ========================================================================
    const isConnected = mode === "connected"
    const isEditable = mode === "local"
    const hasRows = rowCount > 0

    // Get execution state for a row
    const getRowExecutionState = useCallback(
        (rowId: string) => executionResults[rowId] ?? null,
        [executionResults],
    )

    // ========================================================================
    // HANDLERS
    // ========================================================================
    const handleAddRow = useCallback(() => {
        // Create empty data based on columns
        const emptyData: Record<string, unknown> = {}
        columns.forEach((col) => {
            emptyData[col.key] = col.defaultValue ?? ""
        })
        addRowAction(loadableId, emptyData)
    }, [columns, addRowAction, loadableId])

    const handleExecuteRow = useCallback(
        (rowId: string) => {
            const row = rows.find((r) => r.id === rowId)
            if (row && onExecuteRow) {
                onExecuteRow(rowId, row.data)
            }
        },
        [rows, onExecuteRow],
    )

    const handleExecuteAll = useCallback(() => {
        if (onExecuteAll) {
            onExecuteAll()
        }
    }, [onExecuteAll])

    const handleDisconnect = useCallback(() => {
        disconnectAction(loadableId)
        onDisconnect?.()
    }, [disconnectAction, loadableId, onDisconnect])

    const handleClearRows = useCallback(() => {
        clearRowsAction(loadableId)
    }, [clearRowsAction, loadableId])

    const handleSetActiveRow = useCallback(
        (rowId: string) => {
            setActiveRowAction(loadableId, rowId)
        },
        [setActiveRowAction, loadableId],
    )

    const handleUpdateRow = useCallback(
        (rowId: string, data: Record<string, unknown>) => {
            updateRowAction(loadableId, rowId, data)
        },
        [updateRowAction, loadableId],
    )

    const handleRemoveRow = useCallback(
        (rowId: string) => {
            removeRowAction(loadableId, rowId)
        },
        [removeRowAction, loadableId],
    )

    return (
        <Card
            title={
                <Space>
                    <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                        <Database size={16} weight="fill" className="text-green-600" />
                    </div>
                    <div>
                        <Text strong>{title}</Text>
                        <Text type="secondary" className="block text-xs">
                            {rowCount} {rowCount === 1 ? "row" : "rows"}
                        </Text>
                    </div>
                </Space>
            }
            extra={
                <Space>
                    {isConnected ? (
                        <Tag
                            color="blue"
                            closable
                            onClose={(e) => {
                                e.preventDefault()
                                handleDisconnect()
                            }}
                            className={onNavigateToSource ? "cursor-pointer" : ""}
                            onClick={onNavigateToSource}
                        >
                            <span className="inline-flex items-center gap-1">
                                <Link size={12} className="flex-shrink-0" />
                                {connectedSourceName}
                            </span>
                        </Tag>
                    ) : (
                        <Tag color="default">Local</Tag>
                    )}
                    {showConnect && (
                        <Button
                            type="text"
                            size="small"
                            icon={isConnected ? <PencilSimple size={14} /> : <Database size={14} />}
                            onClick={onConnect}
                        >
                            {isConnected ? "Change" : "Load Testset"}
                        </Button>
                    )}
                    {onRemove && (
                        <Button
                            type="text"
                            danger
                            size="small"
                            icon={<Trash size={14} />}
                            onClick={onRemove}
                        />
                    )}
                </Space>
            }
        >
            {/* Empty State */}
            {!hasRows && (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<Text type="secondary">No testcases yet</Text>}
                >
                    <Space>
                        <Button type="primary" icon={<Plus size={14} />} onClick={handleAddRow}>
                            Add Testcase
                        </Button>
                        {showConnect && (
                            <Button icon={<Database size={14} />} onClick={onConnect}>
                                Load Testset
                            </Button>
                        )}
                    </Space>
                </Empty>
            )}

            {/* Row List */}
            {hasRows && (
                <div className="space-y-3">
                    {/* Action Bar */}
                    <div className="flex items-center justify-between pb-3 border-b">
                        <Space>
                            {isEditable && (
                                <Button
                                    size="small"
                                    icon={<Plus size={12} />}
                                    onClick={handleAddRow}
                                >
                                    Add Row
                                </Button>
                            )}
                            {isEditable && rowCount > 0 && (
                                <Button size="small" danger onClick={handleClearRows}>
                                    Clear All
                                </Button>
                            )}
                        </Space>
                        {onExecuteAll && rowCount > 0 && (
                            <Button
                                type="primary"
                                size="small"
                                icon={<Lightning size={12} />}
                                onClick={handleExecuteAll}
                            >
                                Run All ({rowCount})
                            </Button>
                        )}
                    </div>

                    {/* Rows */}
                    {rows.map((row, idx) => {
                        const execState = getRowExecutionState(row.id)
                        return (
                            <LoadableRowCard
                                key={row.id}
                                row={row}
                                columns={columns}
                                index={idx + 1}
                                isActive={row.id === activeRowId}
                                isEditable={isEditable}
                                isExecuting={execState?.status === "running"}
                                executionStatus={execState?.status}
                                executionOutput={execState?.output}
                                executionError={execState?.error}
                                onSelect={() => handleSetActiveRow(row.id)}
                                onUpdate={(data) => handleUpdateRow(row.id, data)}
                                onRemove={() => handleRemoveRow(row.id)}
                                onExecute={() => handleExecuteRow(row.id)}
                            />
                        )
                    })}
                </div>
            )}
        </Card>
    )
}
