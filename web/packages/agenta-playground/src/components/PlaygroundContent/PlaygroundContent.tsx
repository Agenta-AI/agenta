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
 * - Uses loadableController.testset for row/column/execution state
 * - Compound actions for atomic multi-step operations
 */

import {useCallback, useMemo, useState} from "react"

import {
    type RunnableType,
    type InputMapping,
    type OutputConnection,
} from "@agenta/entities/runnable"
import {revisionMolecule} from "@agenta/entities/testset"
import {EntityCommitModal, useBoundCommit} from "@agenta/entities/ui"
import {Splitter} from "antd"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useChainExecution} from "../../hooks"
import {playgroundController, outputConnectionController} from "../../state"
import {ConfigPanel, type OutputReceiverInfo} from "../ConfigPanel"
import {EmptyState} from "../EmptyState"
import type {EntitySelection} from "../EntitySelector"
import {useEntitySelector} from "../EntitySelector"
import {InputMappingModalWrapper, type EntityInfo} from "../InputMappingModal"
import {useLoadable} from "../LoadableEntityPanel"
import {RunnableColumnsLayout, type RunnableNode} from "../RunnableColumnsLayout"
import {TestcasePanel} from "../TestcasePanel"
import {
    TestsetSelectionModal,
    type TestsetSelectionMode,
    type TestsetSelectionPayload,
    type TestsetSavePayload,
} from "../TestsetSelectionModal"
import type {ChainExecutionResult} from "../types"

const SplitterPanel = Splitter.Panel

export function PlaygroundContent() {
    const router = useRouter()
    const {open} = useEntitySelector()

    // State for testset selection modal mode
    const [selectionModalMode, setSelectionModalMode] = useState<TestsetSelectionMode | null>(null)

    // ========================================================================
    // CONTROLLER STATE (using controller API pattern)
    // ========================================================================

    // Dispatch for standard actions via playgroundController.dispatch
    const dispatch = useSetAtom(playgroundController.dispatch)

    // Selectors via playgroundController.selectors.X()
    // Note: selectors are functions that return atoms, so we call them with ()
    const primaryNode = useAtomValue(
        useMemo(() => playgroundController.selectors.primaryNode(), []),
    )
    const hasMultipleNodes = useAtomValue(
        useMemo(() => playgroundController.selectors.hasMultipleNodes(), []),
    )
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const connectedTestset = useAtomValue(
        useMemo(() => playgroundController.selectors.connectedTestset(), []),
    )
    const extraColumns = useAtomValue(
        useMemo(() => playgroundController.selectors.extraColumns(), []),
    )

    // Modal state via playgroundController.selectors
    const _isTestsetModalOpen = useAtomValue(
        useMemo(() => playgroundController.selectors.testsetModalOpen(), []),
    )
    const isMappingModalOpen = useAtomValue(
        useMemo(() => playgroundController.selectors.mappingModalOpen(), []),
    )
    const editingConnectionId = useAtomValue(
        useMemo(() => playgroundController.selectors.editingConnectionId(), []),
    )

    // Output connections via outputConnectionController.selectors
    const allConnections = useAtomValue(
        useMemo(() => outputConnectionController.selectors.allConnections(), []),
    ) as OutputConnection[]

    // Compound actions via playgroundController.actions
    const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
    const addDownstreamNode = useSetAtom(playgroundController.actions.addDownstreamNode)
    const removeNode = useSetAtom(playgroundController.actions.removeNode)
    const changePrimaryNode = useSetAtom(playgroundController.actions.changePrimaryNode)
    const disconnectAndResetToLocal = useSetAtom(
        playgroundController.actions.disconnectAndResetToLocal,
    )

    // Connection actions via outputConnectionController.actions
    const addConnectionAction = useSetAtom(outputConnectionController.actions.addConnection)
    const removeConnectionAction = useSetAtom(outputConnectionController.actions.removeConnection)
    const clearConnectionsAction = useSetAtom(outputConnectionController.actions.clearConnections)
    const updateMappingsAction = useSetAtom(outputConnectionController.actions.updateMappings)

    // ========================================================================
    // DERIVED STATE
    // ========================================================================

    // Convert primary node to the format expected by UI components
    const primaryNodeEntity = useMemo((): EntitySelection | null => {
        if (!primaryNode) return null
        return {
            type: primaryNode.entityType as EntitySelection["type"],
            id: primaryNode.entityId,
            label: primaryNode.label,
        }
    }, [primaryNode])

    // Convert nodes to RunnableNode format for UI components
    const runnableNodes = useMemo((): RunnableNode[] => {
        return nodes.map((node) => ({
            id: node.id,
            entity: {
                type: node.entityType as EntitySelection["type"],
                id: node.entityId,
                label: node.label,
            },
            depth: "depth" in node && typeof node.depth === "number" ? node.depth : 0,
        }))
    }, [nodes])

    // Compute the loadable ID for the current primary runnable's testcases
    const loadableId = useMemo(
        () =>
            primaryNodeEntity ? `testset:${primaryNodeEntity.type}:${primaryNodeEntity.id}` : "",
        [primaryNodeEntity],
    )

    // Get the loadable instance to manage testcases
    // NOTE: Columns are derived reactively from the linked runnable's inputPorts
    // via loadableColumnsFromRunnableAtomFamily. Initial row is created in the
    // addPrimaryNodeAtom action. No React effects needed for initialization.
    const loadable = useLoadable(loadableId)

    // Get the connected revision version (for commit modal)
    // Create an atom that returns null when not connected, or the revision data when connected
    const connectedRevisionAtom = useMemo(
        () =>
            atom((get) => {
                if (!loadable.connectedSourceId) return null
                const dataAtom = revisionMolecule.selectors.data(loadable.connectedSourceId)
                return get(dataAtom)
            }),
        [loadable.connectedSourceId],
    )
    const connectedRevisionData = useAtomValue(connectedRevisionAtom)

    // ========================================================================
    // LOADABLE STATE (columns and rows are derived reactively in the store)
    // ========================================================================
    // Note: Columns are derived from the linked runnable's inputSchema via
    // loadableColumnsAtomFamily. The initial row is created automatically
    // when columns exist but no rows. See store.ts for implementation.
    const {columns: runnableColumns, rows} = loadable

    // Combine runnable columns with extra columns
    const columns = useMemo(() => {
        return [
            ...runnableColumns,
            ...extraColumns.map((col) => ({
                key: col.key,
                name: col.name,
                type: col.type as "string",
                required: false,
            })),
        ]
    }, [runnableColumns, extraColumns])

    // Derive supplied columns from testcase data (keys present in rows)
    const suppliedColumns = useMemo(() => {
        if (rows.length === 0) return []
        // Collect all unique keys from row data
        const keySet = new Set<string>()
        rows.forEach((row) => {
            Object.keys(row.data).forEach((key) => keySet.add(key))
        })
        return Array.from(keySet).map((key) => ({
            key,
            name: key,
        }))
    }, [rows])

    // Compute output receivers for ConfigPanel
    const outputReceivers = useMemo<OutputReceiverInfo[]>(() => {
        if (!primaryNode) return []

        return allConnections
            .filter((c) => c.sourceNodeId === primaryNode.id)
            .map((connection) => {
                const targetNode = runnableNodes.find((n) => n.id === connection.targetNodeId)
                // Skip if target node or its entity is not found
                if (!targetNode || !targetNode.entity) return null

                const validMappings = connection.inputMappings.filter(
                    (m) => m.status === "valid",
                ).length
                const inputPorts =
                    "inputPorts" in targetNode && Array.isArray(targetNode.inputPorts)
                        ? targetNode.inputPorts
                        : []
                const requiredInputs = inputPorts.filter(
                    (p) => typeof p === "object" && p !== null && "required" in p && p.required,
                ).length

                return {
                    connection,
                    entity: targetNode.entity,
                    validMappings,
                    requiredInputs,
                }
            })
            .filter((r): r is OutputReceiverInfo => r !== null)
    }, [primaryNode, allConnections, runnableNodes])

    // Execution results from the loadable - transform to ChainExecutionResult format
    const executionResults = useMemo<Record<string, ChainExecutionResult>>(() => {
        const results: Record<string, ChainExecutionResult> = {}
        // Get execution results from loadable and transform to ChainExecutionResult format
        for (const [rowId, rowExecState] of Object.entries(loadable.executionResults)) {
            results[rowId] = {
                status: rowExecState.status,
                output: rowExecState.output,
                error: rowExecState.error,
                // Trace ID for metrics display
                traceId: rowExecState.traceId,
                // Chain execution fields
                chainProgress: rowExecState.chainProgress,
                chainResults: rowExecState.chainResults,
                isChain: rowExecState.isChain,
                totalStages: rowExecState.totalStages,
            }
        }
        return results
    }, [loadable.executionResults])

    // Get the editing connection for mapping modal
    const editingConnection = useMemo(
        () => allConnections.find((c) => c.id === editingConnectionId) || null,
        [allConnections, editingConnectionId],
    )

    // Get source node for the editing connection
    const editingSourceNode = useMemo(() => {
        if (!editingConnection) return null
        return runnableNodes.find((n) => n.id === editingConnection.sourceNodeId)
    }, [editingConnection, runnableNodes])

    // Get target node for the editing connection
    const editingTargetNode = useMemo(() => {
        if (!editingConnection) return null
        return runnableNodes.find((n) => n.id === editingConnection.targetNodeId)
    }, [editingConnection, runnableNodes])

    // Create entity info for the mapping modal
    const sourceEntityInfo = useMemo((): EntityInfo | null => {
        if (!editingSourceNode) return null
        return {
            type: editingSourceNode.entity.type as RunnableType,
            id: editingSourceNode.entity.id,
            label: editingSourceNode.entity.label || editingSourceNode.entity.id,
        }
    }, [editingSourceNode])

    const targetEntityInfo = useMemo((): EntityInfo | null => {
        if (!editingTargetNode) return null
        return {
            type: editingTargetNode.entity.type as RunnableType,
            id: editingTargetNode.entity.id,
            label: editingTargetNode.entity.label || editingTargetNode.entity.id,
        }
    }, [editingTargetNode])

    // ========================================================================
    // ACTION HANDLERS (dispatch to controller)
    // ========================================================================

    // Add the primary runnable
    const handleAddRunnable = useCallback(async () => {
        const selection = await open({
            title: "Add to Playground",
            allowedTypes: ["appRevision", "evaluatorRevision"],
        })
        if (selection) {
            addPrimaryNode(selection)
            // Clear all connections when adding new primary
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
                // Create connection for the new downstream node
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
                // Remove the target node
                removeNode(connection.targetNodeId)
                // Remove the connection
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
    // TESTSET CONNECTION HANDLERS
    // ========================================================================

    const handleConnectTestset = useCallback(() => {
        // Use TestsetSelectionModal in "load" mode instead of old LoadTestsetModal
        setSelectionModalMode("load")
    }, [])

    const handleNavigateToTestset = useCallback(() => {
        if (connectedTestset?.id) {
            const {workspace_id, project_id} = router.query
            router.push(`/w/${workspace_id}/p/${project_id}/testsets/${connectedTestset.id}`)
        }
    }, [connectedTestset, router])

    const handleDisconnectTestset = useCallback(() => {
        // Use compound action that:
        // 1. Clears loadable state (connectedSourceId, testcase IDs)
        // 2. Regenerates local testset name from primary node label
        // 3. Creates an initial empty row
        disconnectAndResetToLocal(loadableId)
    }, [disconnectAndResetToLocal, loadableId])

    // Open edit selection modal (for modifying which testcases are included)
    const handleEditSelection = useCallback(() => {
        setSelectionModalMode("edit")
    }, [])

    // Handle TestsetSelectionModal confirm (load/edit modes)
    const handleSelectionConfirm = useCallback(
        (payload: TestsetSelectionPayload) => {
            if (selectionModalMode === "edit") {
                // Edit mode - update selection without reconnecting
                loadable.updateTestcaseSelection(payload.selectedTestcaseIds)
            } else if (selectionModalMode === "load") {
                // Load mode - check import mode
                if (payload.importMode === "import" && payload.testcases) {
                    // Import mode: Add selected testcases as new local rows
                    // This keeps the current connection state unchanged
                    loadable.importRows(payload.testcases)
                } else {
                    // Replace mode: Connect to testset and replace current data
                    const displayName = payload.testsetName
                        ? payload.revisionVersion != null
                            ? `${payload.testsetName} v${payload.revisionVersion}`
                            : payload.testsetName
                        : undefined

                    // Get testcase data for connection
                    const testcasesWithIds =
                        payload.testcases?.map((tc, index) => {
                            const id = (tc as {id?: string}).id ?? `testcase-${Date.now()}-${index}`
                            return {id, ...tc}
                        }) ?? []

                    loadable.connectToSource(payload.revisionId, displayName, testcasesWithIds)

                    // Update playground state with connected testset info
                    dispatch({
                        type: "setConnectedTestset",
                        name: displayName ?? null,
                        id: payload.testsetId || null,
                    })
                }
            }
            setSelectionModalMode(null)
        },
        [selectionModalMode, loadable, dispatch],
    )

    // Handle TestsetSelectionModal save confirm (save mode)
    const handleSaveConfirm = useCallback(
        (payload: TestsetSavePayload) => {
            // After saving, connect to the new testset
            loadable.connectToSource(payload.revisionId, payload.testsetName)
            setSelectionModalMode(null)
        },
        [loadable],
    )

    // Handle TestsetSelectionModal cancel
    const handleSelectionCancel = useCallback(() => {
        setSelectionModalMode(null)
    }, [])

    // Bound commit hook - handles validation internally, returns null action when not available
    // Passes loadableId via metadata for reactive column change detection in commit modal
    const {commit: openCommitModal} = useBoundCommit({
        type: "revision",
        id: loadable.connectedSourceId,
        name: connectedRevisionData?.name ?? "Testset",
        canCommit: loadable.hasLocalChanges,
        metadata: {loadableId: loadable.loadableId},
    })

    // Discard local changes
    const handleDiscardChanges = useCallback(() => {
        loadable.discardChanges()
    }, [loadable])

    // Open save testset modal with current local testcases
    // Uses TestsetSelectionModal in "save" mode - reads directly from loadable entity
    const handleOpenSaveTestsetModal = useCallback(() => {
        if (rows.length === 0) return
        setSelectionModalMode("save")
    }, [rows.length])

    // ========================================================================
    // EXTRA COLUMN HANDLERS
    // ========================================================================

    const handleAddExtraColumn = useCallback(
        (name: string) => {
            // Generate key from name (lowercase, no spaces)
            const key = name.toLowerCase().replace(/\s+/g, "_")
            // Check if column already exists
            const existingKeys = new Set([
                ...runnableColumns.map((c) => c.key),
                ...extraColumns.map((c) => c.key),
            ])
            if (existingKeys.has(key)) {
                return // Don't add duplicates
            }
            // Add to playground state (UI column definition)
            dispatch({type: "addExtraColumn", key, name})
            // Add empty value to all testcase rows (makes testset dirty, enables commit)
            loadable.addColumn({key, name, type: "string"})
        },
        [runnableColumns, extraColumns, dispatch, loadable],
    )

    const handleRemoveExtraColumn = useCallback(
        (key: string) => {
            // Remove from playground state
            dispatch({type: "removeExtraColumn", key})
            // Remove value from all testcase rows (makes testset dirty)
            loadable.removeColumn(key)
        },
        [dispatch, loadable],
    )

    // Handler for output mapping columns - only adds to testcase data, NOT to extraColumnsAtom
    // This ensures output-mapped columns appear as "extra" in the execution display
    // rather than as "expected" variables
    const handleAddOutputMappingColumn = useCallback(
        (name: string) => {
            // Generate key from name (lowercase, no spaces)
            const key = name.toLowerCase().replace(/\s+/g, "_")
            // Check if column already exists
            const existingKeys = new Set([
                ...runnableColumns.map((c) => c.key),
                ...extraColumns.map((c) => c.key),
            ])
            if (existingKeys.has(key)) {
                return // Don't add duplicates
            }
            // Only add to testcase data - NOT to extraColumnsAtom
            // This way the column appears in suppliedColumns but not in expected columns
            loadable.addColumn({key, name, type: "string"})
        },
        [runnableColumns, extraColumns, loadable],
    )

    // ========================================================================
    // TESTCASE OPERATION HANDLERS
    // ========================================================================

    const handleAddRow = useCallback(
        (data?: Record<string, unknown>) => {
            // If this is the first row and no testset is connected, set up a local testset
            // Generate a meaningful name based on the primary node's label and date
            if (rows.length === 0 && !connectedTestset?.id) {
                // Generate name from primary node label + date
                const date = new Date()
                const dateStr = date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                })
                const timeStr = date.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                })
                const baseName = primaryNode?.label || "Local"
                const localTestsetName = `${baseName} - ${dateStr}, ${timeStr}`

                dispatch({
                    type: "setConnectedTestset",
                    name: localTestsetName,
                    id: null, // null id indicates it's a local (unsaved) testset
                })
            }
            loadable.addRow(data)
        },
        [loadable, rows.length, connectedTestset?.id, primaryNode?.label, dispatch],
    )

    const handleUpdateRow = useCallback(
        (rowId: string, data: Record<string, unknown>) => {
            loadable.updateRow(rowId, data)
        },
        [loadable],
    )

    const handleRemoveRow = useCallback(
        (rowId: string) => {
            loadable.removeRow(rowId)
        },
        [loadable],
    )

    const handleClearRows = useCallback(() => {
        loadable.clearRows()
    }, [loadable])

    // ========================================================================
    // CHAIN EXECUTION (via hook)
    // ========================================================================

    const {
        executeRow: handleExecuteRow,
        executeAll: handleExecuteAll,
        isExecuting,
    } = useChainExecution(loadableId)

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
                            // RunnableColumnsLayout subscribes directly to atoms for:
                            // - nodes, connections, activeNodeId (core DAG state)
                            // - modal state (mapping modal open/close)
                            // Only testset-related props are passed from parent
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
                                onSaveAsTestset={handleOpenSaveTestsetModal}
                                hasLocalChanges={loadable.hasLocalChanges}
                                onCommitChanges={openCommitModal}
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
                                newColumnKeys={loadable.newColumnKeys}
                                testcaseColumns={columns}
                                testcaseData={loadable.activeRow?.data}
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
                                onSaveAsTestset={handleOpenSaveTestsetModal}
                                hasLocalChanges={loadable.hasLocalChanges}
                                onCommitChanges={openCommitModal}
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
                                newColumnKeys={loadable.newColumnKeys}
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
                            onRevertOverrides={loadable.revertOutputMappingOverrides}
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
                testcaseColumns={loadable.allColumns}
                testcaseData={loadable.activeRow?.data}
            />

            {/* Entity Commit Modal - unified commit modal for revisions */}
            <EntityCommitModal />

            {/* Testset Selection Modal - for editing selection or saving new testset */}
            <TestsetSelectionModal
                open={selectionModalMode !== null}
                mode={selectionModalMode || "edit"}
                loadableId={loadableId}
                connectedRevisionId={loadable.connectedSourceId || undefined}
                connectedTestsetId={connectedTestset?.id || undefined}
                onConfirm={handleSelectionConfirm}
                onSave={handleSaveConfirm}
                onCancel={handleSelectionCancel}
                defaultTestsetName={connectedTestset?.name}
            />
        </div>
    )
}
