/**
 * PlaygroundContent Component
 *
 * Main content area for the playground with two-column layout:
 * - Left: Configuration panel (prompt, model, parameters)
 * - Right: Testcases panel (inputs, run, outputs)
 *
 * This mirrors the current playground design for better UX:
 * - Side-by-side workflow: edit config while viewing results
 * - Clear separation between configuration and execution
 * - Resizable panels via splitter
 *
 * Supports multi-node chains:
 * - Primary runnable with downstream receivers
 * - DAG-based execution with topological ordering
 * - Auto-mapping of outputs to downstream inputs
 *
 * Architecture:
 * - Uses playgroundController for node/edge/modal state management
 * - Uses outputConnectionController for connection state
 * - Uses loadableController for row/column/execution state
 * - Compound actions for atomic multi-step operations
 */

import {useCallback, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import type {InputMapping, TestsetRow} from "@agenta/entities/runnable"
import {useChainExecution, usePlaygroundState, useDerivedState} from "@agenta/playground/react"
import {Splitter} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {ConfigPanel} from "../ConfigPanel"
import {EmptyState} from "../EmptyState"
import type {EntitySelection} from "../EntitySelector"
import {useEntitySelector} from "../EntitySelector"
import {InputMappingModalWrapper} from "../InputMappingModal"
import {RunnableColumnsLayout} from "../RunnableColumnsLayout"
import {TestcasePanel} from "../TestcasePanel"
import {TestsetSelectionModal} from "../TestsetSelectionModal"

import {useTestsetHandlers} from "./hooks/useTestsetHandlers"

const SplitterPanel = Splitter.Panel

export function PlaygroundContent() {
    const {open} = useEntitySelector()

    // ========================================================================
    // CONTROLLER STATE (via extracted hook)
    // ========================================================================
    const {
        dispatch,
        primaryNode,
        hasMultipleNodes,
        nodes,
        connectedTestset,
        extraColumns,
        isMappingModalOpen,
        editingConnectionId,
        allConnections,
        addPrimaryNode,
        addDownstreamNode,
        removeNode,
        changePrimaryNode,
        disconnectAndResetToLocal,
        // WP1: Testset connection compound actions
        connectToTestset,
        importTestcases,
        // WP2: Row with init compound action
        addRowWithInit,
        // WP3: Extra column compound actions
        addExtraColumn,
        removeExtraColumn,
        // WP4: Output mapping column compound action
        addOutputMappingColumn,
        // Connection actions
        addConnectionAction,
        removeConnectionAction,
        clearConnectionsAction,
        updateMappingsAction,
    } = usePlaygroundState()

    // ========================================================================
    // LOADABLE STATE (via direct atoms per agenta-package-practices)
    // ========================================================================
    // Compute the loadable ID for the current primary runnable's testcases
    const loadableId = primaryNode
        ? `testset:${primaryNode.entityType}:${primaryNode.entityId}`
        : ""

    // Memoized selector atoms (per agenta-package-practices: memoize atom selectors)
    const columnsAtom = useMemo(
        () => loadableController.selectors.columns(loadableId),
        [loadableId],
    )
    const allColumnsAtom = useMemo(
        () => loadableController.selectors.allColumns(loadableId),
        [loadableId],
    )
    const rowsAtom = useMemo(() => loadableController.selectors.rows(loadableId), [loadableId])
    const activeRowAtom = useMemo(
        () => loadableController.selectors.activeRow(loadableId),
        [loadableId],
    )
    const connectedSourceAtom = useMemo(
        () => loadableController.selectors.connectedSource(loadableId),
        [loadableId],
    )
    const executionResultsAtom = useMemo(
        () => loadableController.selectors.executionResults(loadableId),
        [loadableId],
    )
    const hasLocalChangesAtom = useMemo(
        () => loadableController.selectors.hasLocalChanges(loadableId),
        [loadableId],
    )
    const totalRowCountAtom = useMemo(
        () => loadableController.selectors.totalRowCount(loadableId),
        [loadableId],
    )
    const newColumnKeysAtom = useMemo(
        () => loadableController.selectors.newColumnKeys(loadableId),
        [loadableId],
    )

    // Subscribe to state
    const runnableColumns = useAtomValue(columnsAtom)
    const allColumns = useAtomValue(allColumnsAtom)
    const rows = useAtomValue(rowsAtom)
    const activeRowId = useAtomValue(activeRowAtom)
    const connectedSource = useAtomValue(connectedSourceAtom)
    const executionResultsRaw = useAtomValue(executionResultsAtom)
    const hasLocalChanges = useAtomValue(hasLocalChangesAtom)
    const totalRowCount = useAtomValue(totalRowCountAtom)
    const newColumnKeys = useAtomValue(newColumnKeysAtom)

    // Derive activeRow from rows using activeRowId
    const activeRow = useMemo((): TestsetRow | null => {
        if (!activeRowId && rows.length > 0) {
            return rows[0] // Default to first row if no explicit selection
        }
        return rows.find((r) => r.id === activeRowId) ?? null
    }, [activeRowId, rows])

    // Action setters
    const updateRowAction = useSetAtom(loadableController.actions.updateRow)
    const removeRowAction = useSetAtom(loadableController.actions.removeRow)
    const clearRowsAction = useSetAtom(loadableController.actions.clearRows)
    const updateTestcaseSelectionAction = useSetAtom(
        loadableController.actions.updateTestcaseSelection,
    )
    const discardChangesAction = useSetAtom(loadableController.actions.discardChanges)
    const revertOutputMappingOverridesAction = useSetAtom(
        loadableController.actions.revertOutputMappingOverrides,
    )

    // ========================================================================
    // DERIVED STATE (via extracted hook)
    // ========================================================================
    const {
        primaryNodeEntity,
        runnableNodes,
        connectedRevisionData,
        columns,
        suppliedColumns,
        outputReceivers,
        executionResults,
        editingConnection,
        sourceEntityInfo,
        targetEntityInfo,
    } = useDerivedState({
        primaryNode,
        nodes,
        allConnections,
        editingConnectionId,
        loadable: {
            connectedSourceId: connectedSource.id,
            columns: runnableColumns,
            rows,
            executionResults: executionResultsRaw,
            activeRow,
        },
        extraColumns,
    })

    // ========================================================================
    // TESTSET HANDLERS (via extracted hook)
    // ========================================================================

    // Wrapped action callbacks for useTestsetHandlers interface
    const updateTestcaseSelection = useCallback(
        (ids: string[]) => updateTestcaseSelectionAction(loadableId, ids),
        [updateTestcaseSelectionAction, loadableId],
    )
    const discardChanges = useCallback(
        () => discardChangesAction(loadableId),
        [discardChangesAction, loadableId],
    )

    const {
        selectionModalMode,
        handleConnectTestset,
        handleNavigateToTestset,
        handleDisconnectTestset,
        handleEditSelection,
        handleSelectionConfirm,
        handleSaveConfirm,
        handleSelectionCancel,
        openCommitModal,
        handleDiscardChanges,
        handleOpenSaveTestsetModal,
    } = useTestsetHandlers({
        connectedTestset,
        loadable: {
            connectedSourceId: connectedSource.id,
            loadableId,
            hasLocalChanges,
            updateTestcaseSelection,
            discardChanges,
        },
        disconnectAndResetToLocal,
        // WP1: Compound actions for atomic testset operations
        connectToTestset,
        importTestcases,
        connectedRevisionData,
        rowCount: rows.length,
    })

    // ========================================================================
    // ACTION HANDLERS
    // ========================================================================

    // Add the primary runnable
    const handleAddRunnable = useCallback(async () => {
        const selection = await open({
            title: "Add to Playground",
            allowedTypes: ["appRevision", "evaluatorRevision"],
        })
        if (selection) {
            addPrimaryNode(selection)
            clearConnectionsAction({})
        }
    }, [open, addPrimaryNode, clearConnectionsAction])

    // Remove the primary runnable (clears everything)
    const handleRemoveRunnable = useCallback(() => {
        dispatch({type: "reset"})
        clearConnectionsAction({})
    }, [dispatch, clearConnectionsAction])

    // Change the primary runnable
    const handleChangeRunnable = useCallback(async () => {
        const selection = await open({
            title: "Change Entity",
            allowedTypes: ["appRevision", "evaluatorRevision"],
        })
        if (selection) {
            changePrimaryNode(selection)
            clearConnectionsAction({})
        }
    }, [open, changePrimaryNode, clearConnectionsAction])

    // Add a downstream runnable
    const handleAddDownstream = useCallback(
        (sourceNodeId: string, entity: EntitySelection) => {
            const result = addDownstreamNode({sourceNodeId, entity})
            if (result) {
                addConnectionAction({
                    sourceNodeId: result.sourceNodeId,
                    targetNodeId: result.nodeId,
                    sourceOutputKey: "output",
                })
            }
        },
        [addDownstreamNode, addConnectionAction],
    )

    // Open entity selector to add a downstream receiver
    const handleAddOutputReceiver = useCallback(
        async (sourceNodeId?: string) => {
            const effectiveSourceNodeId = sourceNodeId || primaryNode?.id
            if (!effectiveSourceNodeId) return

            const selection = await open({
                title: "Add Output Receiver",
                allowedTypes: ["evaluatorRevision", "appRevision"],
            })

            if (selection) {
                handleAddDownstream(effectiveSourceNodeId, selection)
            }
        },
        [primaryNode, open, handleAddDownstream],
    )

    // Open mapping modal
    const handleOpenMappingModal = useCallback(
        (connectionId: string) => {
            dispatch({type: "openModal", modal: "mapping", connectionId})
        },
        [dispatch],
    )

    // Close mapping modal
    const handleCloseMappingModal = useCallback(() => {
        dispatch({type: "closeModal", modal: "mapping"})
    }, [dispatch])

    // Update mappings for a connection
    const handleUpdateMappings = useCallback(
        (connectionId: string, mappings: InputMapping[]) => {
            updateMappingsAction({connectionId, mappings})
            handleCloseMappingModal()
        },
        [updateMappingsAction, handleCloseMappingModal],
    )

    // Remove an output receiver
    const handleRemoveOutputReceiver = useCallback(
        (connectionId: string) => {
            const connection = allConnections.find((c) => c.id === connectionId)
            if (connection) {
                removeNode(connection.targetNodeId)
                removeConnectionAction({connectionId})
            }
        },
        [allConnections, removeNode, removeConnectionAction],
    )

    // Navigate to a receiver's config
    const handleNavigateToReceiver = useCallback(
        (entityId: string) => {
            const node = runnableNodes.find((n) => n.entity.id === entityId)
            if (node) {
                dispatch({type: "selectNode", nodeId: node.id})
            }
        },
        [runnableNodes, dispatch],
    )

    // ========================================================================
    // EXTRA COLUMN HANDLERS
    // ========================================================================

    /**
     * Add an extra column using the compound action
     *
     * WP3: Uses addExtraColumn compound action which:
     * - Validates the column key doesn't already exist
     * - Updates playground extraColumns state
     * - Updates loadable columns via controller
     *
     * This removes dual dispatch from the UI handler.
     */
    const handleAddExtraColumn = useCallback(
        (name: string) => {
            const key = name.toLowerCase().replace(/\s+/g, "_")
            const existingKeys = [
                ...runnableColumns.map((c) => c.key),
                ...extraColumns.map((c) => c.key),
            ]

            addExtraColumn({
                loadableId,
                key,
                name,
                existingColumnKeys: existingKeys,
            })
        },
        [runnableColumns, extraColumns, addExtraColumn, loadableId],
    )

    /**
     * Remove an extra column using the compound action
     *
     * WP3: Uses removeExtraColumn compound action which:
     * - Updates playground extraColumns state
     * - Updates loadable columns via controller
     *
     * This removes dual dispatch from the UI handler.
     */
    const handleRemoveExtraColumn = useCallback(
        (key: string) => {
            removeExtraColumn({
                loadableId,
                key,
            })
        },
        [removeExtraColumn, loadableId],
    )

    /**
     * Add an output mapping column using the compound action
     *
     * WP4: Uses addOutputMappingColumn compound action which:
     * - Normalizes the column name to a key
     * - Validates the column key doesn't already exist
     * - Adds the column to loadable via controller
     *
     * This removes business logic from the UI handler.
     */
    const handleAddOutputMappingColumn = useCallback(
        (name: string) => {
            addOutputMappingColumn({loadableId, name})
        },
        [addOutputMappingColumn, loadableId],
    )

    // ========================================================================
    // TESTCASE OPERATION HANDLERS
    // ========================================================================

    /**
     * Add a row using the compound action
     *
     * WP2: Uses addRowWithInit compound action which:
     * - Handles local testset name initialization if first row
     * - Adds the row via loadable controller
     *
     * This removes business logic from the UI handler.
     */
    const handleAddRow = useCallback(
        (data?: Record<string, unknown>) => {
            addRowWithInit({
                loadableId,
                data,
                entityLabel: primaryNode?.label,
            })
        },
        [addRowWithInit, loadableId, primaryNode?.label],
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

    const handleClearRows = useCallback(() => {
        clearRowsAction(loadableId)
    }, [clearRowsAction, loadableId])

    // ========================================================================
    // CHAIN EXECUTION (via hook)
    // ========================================================================

    const {runStep, isExecuting} = useChainExecution()

    // Wrap runStep to match expected callback signatures
    const handleExecuteRow = useCallback(
        (rowId: string, data: Record<string, unknown>) => {
            runStep({stepId: rowId, data})
        },
        [runStep],
    )

    const handleExecuteAll = useCallback(() => {
        // Execute all rows sequentially
        rows.forEach((row) => {
            runStep({stepId: row.id, data: row.data})
        })
    }, [runStep, rows])

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <div className="flex flex-col h-[calc(100dvh-75px)] overflow-hidden bg-gray-50">
            {/* Content */}
            {!primaryNodeEntity ? (
                <div className="flex-1 flex items-center justify-center">
                    <EmptyState onAddRunnable={handleAddRunnable} />
                </div>
            ) : (
                <Splitter className="h-full">
                    {/* Left Panel: Configuration + Data Source Connections */}
                    <SplitterPanel
                        defaultSize="50%"
                        min="30%"
                        max="70%"
                        className="!h-full"
                        collapsible
                    >
                        {hasMultipleNodes ? (
                            <RunnableColumnsLayout
                                columns={runnableColumns}
                                suppliedColumns={suppliedColumns}
                                connectedTestsetName={connectedTestset?.name || undefined}
                                connectedTestsetId={connectedTestset?.id}
                                onConnectTestset={handleConnectTestset}
                                onNavigateToTestset={
                                    connectedTestset?.id ? handleNavigateToTestset : undefined
                                }
                                onDisconnectTestset={handleDisconnectTestset}
                                localTestcaseCount={rows.length}
                                totalTestcaseCount={totalRowCount}
                                onSaveAsTestset={handleOpenSaveTestsetModal}
                                hasLocalChanges={hasLocalChanges}
                                onCommitChanges={openCommitModal ?? undefined}
                                isCommitting={false}
                                onDiscardChanges={handleDiscardChanges}
                                onEditSelection={handleEditSelection}
                                outputReceivers={outputReceivers}
                                onAddOutputReceiver={() => handleAddOutputReceiver()}
                                onEditOutputReceiver={handleOpenMappingModal}
                                onRemoveOutputReceiver={handleRemoveOutputReceiver}
                                onNavigateToReceiver={handleNavigateToReceiver}
                                extraColumns={extraColumns}
                                onAddExtraColumn={handleAddExtraColumn}
                                onAddOutputMappingColumn={handleAddOutputMappingColumn}
                                onRemoveExtraColumn={handleRemoveExtraColumn}
                                newColumnKeys={newColumnKeys}
                                testcaseColumns={columns}
                                testcaseData={activeRow?.data}
                                loadableId={loadableId}
                                showOutputMappings={true}
                            />
                        ) : (
                            <ConfigPanel
                                entity={primaryNodeEntity}
                                onRemove={handleRemoveRunnable}
                                onChange={handleChangeRunnable}
                                columns={runnableColumns}
                                suppliedColumns={suppliedColumns}
                                connectedTestsetName={connectedTestset?.name || undefined}
                                connectedTestsetId={connectedTestset?.id}
                                onConnectTestset={handleConnectTestset}
                                onNavigateToTestset={
                                    connectedTestset?.id ? handleNavigateToTestset : undefined
                                }
                                onDisconnectTestset={handleDisconnectTestset}
                                localTestcaseCount={rows.length}
                                totalTestcaseCount={totalRowCount}
                                onSaveAsTestset={handleOpenSaveTestsetModal}
                                hasLocalChanges={hasLocalChanges}
                                onCommitChanges={openCommitModal ?? undefined}
                                isCommitting={false}
                                onDiscardChanges={handleDiscardChanges}
                                onEditSelection={handleEditSelection}
                                outputReceivers={outputReceivers}
                                onAddOutputReceiver={() => handleAddOutputReceiver()}
                                onEditOutputReceiver={handleOpenMappingModal}
                                onRemoveOutputReceiver={handleRemoveOutputReceiver}
                                onNavigateToReceiver={handleNavigateToReceiver}
                                extraColumns={extraColumns}
                                onAddExtraColumn={handleAddExtraColumn}
                                onAddOutputMappingColumn={handleAddOutputMappingColumn}
                                onRemoveExtraColumn={handleRemoveExtraColumn}
                                newColumnKeys={newColumnKeys}
                                loadableId={loadableId}
                                showOutputMappings={true}
                            />
                        )}
                    </SplitterPanel>

                    {/* Right Panel: Execution only (testcase data + run) */}
                    <SplitterPanel defaultSize="50%" collapsible className="!h-full">
                        <TestcasePanel
                            loadableId={loadableId}
                            columns={columns}
                            suppliedColumns={suppliedColumns}
                            rows={rows}
                            executionResults={executionResults}
                            onAddRow={handleAddRow}
                            onUpdateRow={handleUpdateRow}
                            onRemoveRow={handleRemoveRow}
                            onClearRows={handleClearRows}
                            onExecuteRow={handleExecuteRow}
                            onExecuteAll={handleExecuteAll}
                            isExecuting={isExecuting}
                            onRevertOverrides={(rowId) =>
                                revertOutputMappingOverridesAction(loadableId, rowId)
                            }
                        />
                    </SplitterPanel>
                </Splitter>
            )}

            {/* Input Mapping Modal */}
            <InputMappingModalWrapper
                open={isMappingModalOpen}
                onClose={handleCloseMappingModal}
                connection={editingConnection}
                sourceEntity={sourceEntityInfo}
                targetEntity={targetEntityInfo}
                onSave={handleUpdateMappings}
                testcaseColumns={allColumns}
                testcaseData={activeRow?.data}
            />

            {/* Testset Selection Modal - for editing selection or saving new testset */}
            <TestsetSelectionModal
                open={selectionModalMode !== null}
                mode={selectionModalMode || "edit"}
                loadableId={loadableId}
                connectedRevisionId={connectedSource.id || undefined}
                onConfirm={handleSelectionConfirm}
                onSave={handleSaveConfirm}
                onCancel={handleSelectionCancel}
                defaultTestsetName={connectedTestset?.name ?? undefined}
            />
        </div>
    )
}
