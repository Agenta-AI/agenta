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

import {useCallback} from "react"

import {useLoadable, type TestsetColumn} from "@agenta/entities/runnable"
import {Database, Lightning, Link, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {Button, Card, Empty, Space, Tag, Typography} from "antd"

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
    const loadable = useLoadable(loadableId)

    const handleAddRow = useCallback(() => {
        // Create empty data based on columns
        const emptyData: Record<string, unknown> = {}
        columns.forEach((col) => {
            emptyData[col.key] = col.defaultValue ?? ""
        })
        loadable.addRow(emptyData)
    }, [columns, loadable])

    const handleExecuteRow = useCallback(
        (rowId: string) => {
            const row = loadable.rows.find((r) => r.id === rowId)
            if (row && onExecuteRow) {
                onExecuteRow(rowId, row.data)
            }
        },
        [loadable.rows, onExecuteRow],
    )

    const handleExecuteAll = useCallback(() => {
        if (onExecuteAll) {
            onExecuteAll()
        }
    }, [onExecuteAll])

    const isConnected = loadable.mode === "connected"
    const isEditable = loadable.mode === "local"
    const hasRows = loadable.rowCount > 0

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
                            {loadable.rowCount} {loadable.rowCount === 1 ? "row" : "rows"}
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
                                loadable.disconnect()
                                onDisconnect?.()
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
                            {isEditable && loadable.rowCount > 0 && (
                                <Button size="small" danger onClick={() => loadable.clearRows()}>
                                    Clear All
                                </Button>
                            )}
                        </Space>
                        {onExecuteAll && loadable.rowCount > 0 && (
                            <Button
                                type="primary"
                                size="small"
                                icon={<Lightning size={12} />}
                                onClick={handleExecuteAll}
                            >
                                Run All ({loadable.rowCount})
                            </Button>
                        )}
                    </div>

                    {/* Rows */}
                    {loadable.rows.map((row, idx) => {
                        const execState = loadable.getRowExecutionState(row.id)
                        return (
                            <LoadableRowCard
                                key={row.id}
                                row={row}
                                columns={columns}
                                index={idx + 1}
                                isActive={row.id === loadable.activeRowId}
                                isEditable={isEditable}
                                isExecuting={execState?.status === "running"}
                                executionStatus={execState?.status}
                                executionOutput={execState?.output}
                                executionError={execState?.error}
                                onSelect={() => loadable.setActiveRow(row.id)}
                                onUpdate={(data) => loadable.updateRow(row.id, data)}
                                onRemove={() => loadable.removeRow(row.id)}
                                onExecute={() => handleExecuteRow(row.id)}
                            />
                        )
                    })}
                </div>
            )}
        </Card>
    )
}
