/**
 * RunnableEntityPanel Component
 *
 * Displays a runnable entity (App Revision or Evaluator) with its
 * configuration and execution controls.
 *
 * Uses runnableBridge for state management.
 * Testcases are managed via the LoadableEntityPanel component.
 *
 * Uses context injection for CommitVariantChangesButton.
 *
 * Note: Loadable initialization (columns and initial row) is handled reactively
 * in the store via loadableColumnsAtomFamily and loadableRowsAtomFamily.
 * The linking is done in the addPrimaryNode action.
 */

import {useCallback, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {
    runnableBridge,
    type RunnableType,
    type RunnableData,
    type AppRevisionData,
} from "@agenta/entities/runnable"
import {useChainExecution} from "@agenta/playground"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {X, Lightning, PencilSimple, TextT} from "@phosphor-icons/react"
import {Button, Card, Tag, Space, Typography} from "antd"
import {useAtomValue} from "jotai"

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

    // Generate a stable loadable ID for this entity's testcases
    const loadableId = useMemo(() => `testset:${type}:${entity.id}`, [type, entity.id])

    // Use bridge selectors for runnable data access
    const dataAtom = useMemo(() => runnableBridge.data(entity.id), [entity.id])
    const queryAtom = useMemo(() => runnableBridge.query(entity.id), [entity.id])
    const isDirtyAtom = useMemo(() => runnableBridge.isDirty(entity.id), [entity.id])

    const data = useAtomValue(dataAtom)
    const query = useAtomValue(queryAtom)
    const isDirty = useAtomValue(isDirtyAtom)

    // Use chain execution hook for running testcases
    const {runStep} = useChainExecution()

    // Get the latest execution result for display (first row's result as summary)
    const executionResultsAtom = useMemo(
        () => loadableController.selectors.executionResults(loadableId),
        [loadableId],
    )
    const executionResults = useAtomValue(executionResultsAtom)
    const lastResult = useMemo(() => {
        const results = Object.values(executionResults)
        // Get the most recent completed result
        const completedResults = results.filter(
            (r) => r?.status === "success" || r?.status === "error",
        )
        return completedResults[completedResults.length - 1] ?? null
    }, [executionResults])

    // Get columns - derived reactively from linked runnable's inputPorts
    // via loadableColumnsFromRunnableAtomFamily (updates when prompt template changes)
    const columnsAtom = useMemo(
        () => loadableController.selectors.columns(loadableId),
        [loadableId],
    )
    const columns = useAtomValue(columnsAtom)

    // Execute a single row
    const handleExecuteRow = useCallback(
        (rowId: string, rowData: Record<string, unknown>) => {
            runStep({stepId: rowId, data: rowData})
        },
        [runStep],
    )

    const getStatusTag = () => {
        if (query.isPending) {
            return <Tag color="warning">Loading...</Tag>
        }
        if (query.isError) {
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
                                typeof (data as AppRevisionData)?.revision === "number" && (
                                    <VersionBadge
                                        version={(data as AppRevisionData).revision as number}
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
                            disabled={!isDirty}
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
                <ConfigurationSection
                    type={type}
                    entityId={entity.id}
                    data={data as RunnableData | null}
                />

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
                {lastResult?.output !== undefined && (
                    <div className="border-t pt-4">
                        <Text strong className="block mb-2">
                            Last Output
                        </Text>
                        <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-32">
                            {typeof lastResult.output === "string"
                                ? lastResult.output
                                : JSON.stringify(lastResult.output, null, 2)}
                        </pre>
                    </div>
                )}
            </Space>
        </Card>
    )
}
