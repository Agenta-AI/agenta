/**
 * RunnableEntityPanel Component
 *
 * Displays a runnable entity (App Revision or Evaluator) with its
 * configuration and execution controls.
 *
 * Uses the unified useRunnable hook for state management.
 * Testcases are managed via the LoadableEntityPanel component.
 *
 * Uses context injection for CommitVariantChangesButton.
 *
 * Note: Loadable initialization (columns and initial row) is handled reactively
 * in the store via loadableColumnsAtomFamily and loadableRowsAtomFamily.
 * The linking is done in the addPrimaryNode action.
 */

import {useCallback, useMemo} from "react"

import {
    useRunnable,
    useLoadable,
    type RunnableType,
    type AppRevisionData,
} from "@agenta/entities/runnable"
import {VersionBadge} from "@agenta/ui"
import {X, Lightning, PencilSimple, TextT} from "@phosphor-icons/react"
import {Button, Card, Tag, Space, Typography} from "antd"

import {usePlaygroundUI} from "../../context"
import {ConfigurationSection} from "../ConfigurationSection"
import type {EntitySelection} from "../EntitySelector"
import {LoadableEntityPanel} from "../LoadableEntityPanel"

const {Text} = Typography

export interface RunnableEntityPanelProps {
    entity: EntitySelection
    onRemove: () => void
    /** Callback when the entity should be changed */
    onChange?: () => void
    /** Callback when connect testset is clicked */
    onConnectTestset?: () => void
    /** Name of the connected testset (for display) */
    connectedTestsetName?: string
    /** Callback when connected testset tag is clicked (navigate to testset) */
    onNavigateToTestset?: () => void
    /** Callback when testset is disconnected */
    onDisconnectTestset?: () => void
}

export function RunnableEntityPanel({
    entity,
    onRemove,
    onChange,
    onConnectTestset,
    connectedTestsetName,
    onNavigateToTestset,
    onDisconnectTestset,
}: RunnableEntityPanelProps) {
    // Get injectable components from context
    const {CommitVariantChangesButton} = usePlaygroundUI()

    const type = entity.type as RunnableType

    // Use the unified runnable hook - handles all state management
    const runnable = useRunnable(type, entity.id)

    // Generate a stable loadable ID for this entity's testcases
    const loadableId = useMemo(() => `testset:${type}:${entity.id}`, [type, entity.id])

    // Get loadable - columns and rows are derived reactively from linked runnable
    const loadable = useLoadable(loadableId)

    // Columns are derived from runnable's inputPorts via loadableColumnsAtomFamily
    const columns = loadable.columns

    // Execute a single row
    const handleExecuteRow = useCallback(
        (_rowId: string, data: Record<string, unknown>) => {
            runnable.execute(data)
        },
        [runnable],
    )

    const getStatusTag = () => {
        if (runnable.isPending) {
            return <Tag color="warning">Loading...</Tag>
        }
        if (runnable.isError) {
            return <Tag color="error">Error</Tag>
        }
        return <Tag color="success">Ready</Tag>
    }

    return (
        <Card
            title={
                <Space>
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Lightning size={16} weight="fill" className="text-blue-600" />
                    </div>
                    <div>
                        <div className="flex items-center gap-1">
                            <Text strong>{entity.label}</Text>
                            {type === "appRevision" &&
                                (runnable.data as AppRevisionData)?.revision !== undefined && (
                                    <VersionBadge
                                        version={(runnable.data as AppRevisionData).revision}
                                        variant="chip"
                                    />
                                )}
                        </div>
                        <Text type="secondary" className="block text-xs capitalize">
                            {entity.type}
                        </Text>
                    </div>
                </Space>
            }
            extra={
                <Space>
                    {getStatusTag()}
                    {type === "appRevision" && (
                        <CommitVariantChangesButton
                            variantId={entity.id}
                            label="Commit"
                            size="small"
                            disabled={!runnable.isDirty}
                            commitType="parameters"
                        />
                    )}
                    {onChange && (
                        <Button
                            type="text"
                            icon={<PencilSimple size={16} />}
                            onClick={onChange}
                            title="Change"
                        />
                    )}
                    <Button
                        type="text"
                        danger
                        icon={<X size={16} />}
                        onClick={onRemove}
                        title="Remove"
                    />
                </Space>
            }
        >
            <Space direction="vertical" size="middle" className="w-full">
                {/* Configuration Section (DrillIn) */}
                <ConfigurationSection type={type} entityId={entity.id} data={runnable.data} />

                {/* Inputs Section */}
                {columns.length > 0 && (
                    <Card
                        size="small"
                        title={
                            <Space>
                                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                    <TextT size={16} weight="fill" className="text-purple-600" />
                                </div>
                                <div>
                                    <Text strong>Inputs</Text>
                                    <Text type="secondary" className="block text-xs">
                                        {columns.length} {columns.length === 1 ? "field" : "fields"}
                                    </Text>
                                </div>
                            </Space>
                        }
                    >
                        <div className="flex flex-wrap gap-2">
                            {columns.map((col) => (
                                <Tag key={col.key} color="blue">
                                    {col.name}
                                </Tag>
                            ))}
                        </div>
                    </Card>
                )}

                {/* Testcases Section (Loadable) */}
                <LoadableEntityPanel
                    loadableId={loadableId}
                    columns={columns}
                    title="Testcases"
                    onExecuteRow={handleExecuteRow}
                    showConnect={!!onConnectTestset}
                    onConnect={onConnectTestset}
                    connectedSourceName={connectedTestsetName}
                    onNavigateToSource={onNavigateToTestset}
                    onDisconnect={onDisconnectTestset}
                />

                {/* Output Preview (from last execution) */}
                {runnable.lastResult?.output !== undefined && (
                    <div className="border-t pt-4">
                        <Text strong className="block mb-2">
                            Last Output
                        </Text>
                        <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-32">
                            {typeof runnable.lastResult.output === "string"
                                ? runnable.lastResult.output
                                : JSON.stringify(runnable.lastResult.output, null, 2)}
                        </pre>
                    </div>
                )}
            </Space>
        </Card>
    )
}
