/**
 * RunnableColumnsLayout Component
 *
 * Multi-column navigation layout for managing multiple runnables in a chain.
 * Shows tab navigation between: Primary | Downstream 1 | Downstream 2 | ...
 * Active column displays the full ConfigPanel for that runnable.
 *
 * Features:
 * - Tab navigation between runnable configs
 * - Visual indicators for connection status
 * - Add downstream button integrated in tabs
 * - Maintains consistent panel structure
 *
 * Architecture:
 * - Uses playgroundController.selectors for core DAG state
 * - Uses outputConnectionController.selectors for connection state
 * - Uses controller.dispatch for actions
 * - Receives testset-related props from parent (depend on loadable context)
 */

import {memo, useCallback, useMemo} from "react"

import type {OutputConnection, TestsetColumn} from "@agenta/entities/runnable"
import {
    playgroundController,
    outputConnectionController,
    type RunnableNode,
    type OutputReceiverInfo,
} from "@agenta/playground"
import {Flask, Lightning, Plus} from "@phosphor-icons/react"
import {Button, Tabs, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {ConfigPanel} from "../ConfigPanel"
import type {EntitySelection} from "../EntitySelector"
import {useEntitySelector} from "../EntitySelector"

const {Text} = Typography

// Re-export RunnableNode for backwards compatibility
export type {RunnableNode}

/**
 * Props that still need to come from parent (testset/loadable context)
 */
export interface RunnableColumnsLayoutProps {
    /** Expected input columns for the primary runnable */
    columns: TestsetColumn[]
    /** Supplied input columns */
    suppliedColumns?: {key: string; name: string}[]
    /** Connected testset name */
    connectedTestsetName?: string
    /** Connected testset ID - if set, it's a remote testset; if null/undefined with name, it's local */
    connectedTestsetId?: string | null
    /** Testset connection handlers */
    onConnectTestset?: () => void
    onNavigateToTestset?: () => void
    onDisconnectTestset?: () => void
    /** Local testcase info */
    localTestcaseCount?: number
    /** Total testcase count including hidden */
    totalTestcaseCount?: number
    onSaveAsTestset?: () => void
    /** Whether there are uncommitted local changes to the connected testset */
    hasLocalChanges?: boolean
    /** Callback to commit local changes to connected testset as new revision */
    onCommitChanges?: () => void | Promise<void>
    /** Whether commit is in progress */
    isCommitting?: boolean
    /** Callback to discard local changes */
    onDiscardChanges?: () => void
    /** Callback to edit testcase selection */
    onEditSelection?: () => void
    /** Output receivers info for primary node */
    outputReceivers?: import("../ConfigPanel").OutputReceiverInfo[]
    /** Handler to add output receiver */
    onAddOutputReceiver?: () => void
    /** Handler to edit output receiver mappings */
    onEditOutputReceiver?: (connectionId: string) => void
    /** Handler to remove output receiver */
    onRemoveOutputReceiver?: (connectionId: string) => void
    /** Handler to navigate to receiver config */
    onNavigateToReceiver?: (entityId: string) => void
    /** Extra columns added by the user (beyond runnable input vars) */
    extraColumns?: {key: string; name: string; type: string}[]
    /** Callback to add a new extra column */
    onAddExtraColumn?: (name: string) => void
    /** Callback to remove an extra column */
    onRemoveExtraColumn?: (key: string) => void
    /** Column keys that are newly added (from prompt template but not in original testcase data) */
    newColumnKeys?: string[]
    /** All testcase columns for mapping (includes runnable columns + extra columns) */
    testcaseColumns?: TestsetColumn[]
    /** Active testcase data for test runs in mapping modal */
    testcaseData?: Record<string, unknown>
    /** Loadable ID for output mapping (primary node only) */
    loadableId?: string
    /** Whether to show the output mappings section (primary node only) */
    showOutputMappings?: boolean
    /** Callback to add output mapping column (only adds to testcase data, not to extraColumns) */
    onAddOutputMappingColumn?: (name: string) => void
}

/**
 * Get icon for entity type
 */
function getEntityIcon(type: string) {
    switch (type) {
        case "evaluatorRevision":
            return <Flask size={14} weight="fill" className="text-purple-500" />
        case "appRevision":
        default:
            return <Lightning size={14} weight="fill" className="text-blue-500" />
    }
}

/**
 * Convert PlaygroundNode to RunnableNode format for UI
 */
function toRunnableNode(node: {
    id: string
    entityType: string
    entityId: string
    label?: string
    depth?: number
}): RunnableNode {
    return {
        id: node.id,
        entity: {
            type: node.entityType as EntitySelection["type"],
            id: node.entityId,
            label: node.label,
        },
        depth: node.depth ?? 0,
    }
}

/**
 * RunnableColumnsLayout - Multi-column navigation for runnable chain
 *
 * Uses controller API for state:
 * - playgroundController.selectors.nodes()
 * - playgroundController.selectors.selectedNodeId()
 * - playgroundController.selectors.mappingModalOpen()
 * - playgroundController.selectors.editingConnectionId()
 * - outputConnectionController.selectors.allConnections()
 *
 * Wrapped with React.memo to prevent unnecessary re-renders when parent
 * re-renders but props haven't changed. This is important for performance
 * when sibling components (e.g., TestcasePanel) update frequently during execution.
 */
export const RunnableColumnsLayout = memo(function RunnableColumnsLayout({
    columns,
    suppliedColumns,
    connectedTestsetName,
    connectedTestsetId,
    onConnectTestset,
    onNavigateToTestset,
    onDisconnectTestset,
    localTestcaseCount,
    totalTestcaseCount,
    onSaveAsTestset,
    hasLocalChanges,
    onCommitChanges,
    isCommitting,
    onDiscardChanges,
    onEditSelection,
    outputReceivers,
    onAddOutputReceiver,
    onEditOutputReceiver,
    onRemoveOutputReceiver,
    onNavigateToReceiver,
    extraColumns,
    onAddExtraColumn,
    onAddOutputMappingColumn,
    onRemoveExtraColumn,
    newColumnKeys,
    testcaseColumns,
    testcaseData,
    loadableId,
    showOutputMappings = false,
}: RunnableColumnsLayoutProps) {
    const {open} = useEntitySelector()

    // ========================================================================
    // CONTROLLER SELECTORS (proper API usage)
    // ========================================================================

    // Core DAG state via playgroundController.selectors
    const playgroundNodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const activeNodeId = useAtomValue(
        useMemo(() => playgroundController.selectors.selectedNodeId(), []),
    )

    // Output connections via outputConnectionController.selectors
    const connections = useAtomValue(
        useMemo(() => outputConnectionController.selectors.allConnections(), []),
    ) as OutputConnection[]

    // Note: Modal state (editingConnectionId, etc.) is now managed in PlaygroundContent
    // where the InputMappingModal is rendered to avoid duplicates

    // ========================================================================
    // CONTROLLER ACTIONS
    // ========================================================================

    // Dispatch for standard actions
    const dispatch = useSetAtom(playgroundController.dispatch)

    // Compound actions via playgroundController.actions
    const addDownstreamNode = useSetAtom(playgroundController.actions.addDownstreamNode)
    const removeNode = useSetAtom(playgroundController.actions.removeNode)

    // Connection actions via outputConnectionController.actions
    const addConnectionAction = useSetAtom(outputConnectionController.actions.addConnection)
    const removeConnectionAction = useSetAtom(outputConnectionController.actions.removeConnection)
    const clearConnectionsAction = useSetAtom(outputConnectionController.actions.clearConnections)

    // ========================================================================
    // DERIVED STATE
    // ========================================================================

    // Convert nodes to RunnableNode format
    const nodes = useMemo(
        () =>
            playgroundNodes.map((n) =>
                toRunnableNode({
                    id: n.id,
                    entityType: n.entityType,
                    entityId: n.entityId,
                    label: n.label,
                    depth: n.depth,
                }),
            ),
        [playgroundNodes],
    )

    // Sort nodes by depth for tab ordering
    const sortedNodes = useMemo(() => [...nodes].sort((a, b) => a.depth - b.depth), [nodes])

    // Get active node
    const activeNode = useMemo(
        () => nodes.find((n) => n.id === activeNodeId),
        [nodes, activeNodeId],
    )

    // Get downstream connections for the active node
    const downstreamConnections = useMemo(
        () => connections.filter((c) => c.sourceNodeId === activeNodeId),
        [connections, activeNodeId],
    )

    // Compute output receivers info for the active node
    const activeNodeOutputReceivers = useMemo<OutputReceiverInfo[]>(() => {
        return downstreamConnections
            .map((conn) => {
                const targetNode = nodes.find((n) => n.id === conn.targetNodeId)
                // Skip if target node or its entity is not found
                if (!targetNode || !targetNode.entity) return null

                const validMappings = conn.inputMappings.filter((m) => m.status === "valid").length
                const requiredInputs = targetNode.inputPorts?.filter((p) => p.required).length ?? 0

                return {
                    connection: conn,
                    entity: targetNode.entity,
                    validMappings,
                    requiredInputs,
                }
            })
            .filter((r): r is OutputReceiverInfo => r !== null)
    }, [downstreamConnections, nodes])

    // Note: editingConnection, editingSourceNode, editingTargetNode moved to PlaygroundContent
    // as they're only needed for the InputMappingModal which now renders there

    // Get incoming connection for the active node
    const activeIncomingConnection = useMemo(
        () => connections.find((c) => c.targetNodeId === activeNodeId),
        [connections, activeNodeId],
    )

    // Get source node for the active node's incoming connection
    const sourceNode = useMemo(() => {
        if (!activeIncomingConnection) return null
        return nodes.find((n) => n.id === activeIncomingConnection.sourceNodeId)
    }, [activeIncomingConnection, nodes])

    // ========================================================================
    // ACTION HANDLERS
    // ========================================================================

    // Handle adding a downstream receiver via EntitySelector
    const handleAddOutputReceiver = useCallback(
        async (sourceNodeId: string) => {
            const selection = await open({
                title: "Add Output Receiver",
                allowedTypes: ["evaluatorRevision", "appRevision"],
            })

            if (selection) {
                const result = addDownstreamNode({sourceNodeId, entity: selection})
                if (result) {
                    // Create connection for the new downstream node
                    addConnectionAction({
                        sourceNodeId: result.sourceNodeId,
                        targetNodeId: result.nodeId,
                        sourceOutputKey: "output",
                    })
                }
            }
        },
        [open, addDownstreamNode, addConnectionAction],
    )

    // Handle opening mapping modal
    const handleOpenMappingModal = useCallback(
        (connectionId: string) => {
            dispatch({type: "openModal", modal: "mapping", connectionId})
        },
        [dispatch],
    )

    // Note: handleCloseMappingModal and handleSaveMappings moved to PlaygroundContent
    // as they're only needed for the InputMappingModal which now renders there

    // Handle active node change
    const handleActiveNodeChange = useCallback(
        (nodeId: string) => {
            dispatch({type: "selectNode", nodeId})
        },
        [dispatch],
    )

    // Handle removing a node
    const handleRemoveNode = useCallback(
        (nodeId: string) => {
            const result = removeNode(nodeId)
            if (result.includes("__clear_all__")) {
                clearConnectionsAction({})
            } else {
                // Remove connections for the removed node
                connections
                    .filter((c) => c.sourceNodeId === nodeId || c.targetNodeId === nodeId)
                    .forEach((c) => removeConnectionAction({connectionId: c.id}))
            }
        },
        [removeNode, clearConnectionsAction, connections, removeConnectionAction],
    )

    // ========================================================================
    // RENDER
    // ========================================================================

    // Build tab items
    const tabItems = sortedNodes.map((node) => {
        const isPrimary = node.depth === 0
        const incomingConnection = connections.find((c) => c.targetNodeId === node.id)
        const hasInvalidMappings = incomingConnection?.inputMappings.some(
            (m) => m.status !== "valid",
        )

        return {
            key: node.id,
            label: (
                <div className="flex items-center gap-2 px-1">
                    {getEntityIcon(node.entity.type)}
                    <span className="max-w-[120px] truncate">{node.entity.label}</span>
                    {!isPrimary && (
                        <>
                            {hasInvalidMappings ? (
                                <Tag color="orange" className="m-0 text-xs">
                                    !
                                </Tag>
                            ) : (
                                <Tag color="green" className="m-0 text-xs">
                                    ✓
                                </Tag>
                            )}
                        </>
                    )}
                </div>
            ),
            closable: !isPrimary,
        }
    })

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Tab Navigation */}
            <div className="border-b border-gray-200 bg-white">
                <div className="flex items-center">
                    <Tabs
                        activeKey={activeNodeId || ""}
                        onChange={handleActiveNodeChange}
                        type="editable-card"
                        hideAdd
                        onEdit={(targetKey, action) => {
                            if (action === "remove" && typeof targetKey === "string") {
                                handleRemoveNode(targetKey)
                            }
                        }}
                        items={tabItems}
                        className="flex-1"
                        tabBarStyle={{marginBottom: 0}}
                    />

                    {/* Add Downstream Button */}
                    {activeNode && (
                        <Tooltip title="Add output receiver">
                            <Button
                                type="text"
                                size="small"
                                icon={<Plus size={14} />}
                                onClick={() => handleAddOutputReceiver(activeNode.id)}
                                className="mr-2"
                            />
                        </Tooltip>
                    )}
                </div>
            </div>

            {/* Active Node Config Panel */}
            <div className="flex-1 overflow-hidden">
                {activeNode && (
                    <ConfigPanel
                        entity={activeNode.entity}
                        onRemove={() => handleRemoveNode(activeNode.id)}
                        onChange={undefined} // Change is handled via tab selection
                        columns={activeNode.depth === 0 ? columns : []}
                        suppliedColumns={activeNode.depth === 0 ? suppliedColumns : []}
                        connectedTestsetName={
                            activeNode.depth === 0 ? connectedTestsetName : undefined
                        }
                        connectedTestsetId={activeNode.depth === 0 ? connectedTestsetId : undefined}
                        onConnectTestset={activeNode.depth === 0 ? onConnectTestset : undefined}
                        onNavigateToTestset={
                            activeNode.depth === 0 ? onNavigateToTestset : undefined
                        }
                        onDisconnectTestset={
                            activeNode.depth === 0 ? onDisconnectTestset : undefined
                        }
                        localTestcaseCount={activeNode.depth === 0 ? localTestcaseCount : 0}
                        totalTestcaseCount={activeNode.depth === 0 ? totalTestcaseCount : 0}
                        onSaveAsTestset={activeNode.depth === 0 ? onSaveAsTestset : undefined}
                        hasLocalChanges={activeNode.depth === 0 ? hasLocalChanges : false}
                        onCommitChanges={activeNode.depth === 0 ? onCommitChanges : undefined}
                        isCommitting={activeNode.depth === 0 ? isCommitting : false}
                        onDiscardChanges={activeNode.depth === 0 ? onDiscardChanges : undefined}
                        onEditSelection={activeNode.depth === 0 ? onEditSelection : undefined}
                        outputReceivers={activeNodeOutputReceivers}
                        onAddOutputReceiver={() => handleAddOutputReceiver(activeNode.id)}
                        onEditOutputReceiver={handleOpenMappingModal}
                        onRemoveOutputReceiver={(connectionId) => {
                            const conn = connections.find((c) => c.id === connectionId)
                            if (conn) {
                                handleRemoveNode(conn.targetNodeId)
                            }
                        }}
                        onNavigateToReceiver={(entityId) => {
                            dispatch({type: "selectNode", nodeId: entityId})
                        }}
                        isDownstream={activeNode.depth > 0}
                        extraColumns={activeNode.depth === 0 ? extraColumns : []}
                        onAddExtraColumn={activeNode.depth === 0 ? onAddExtraColumn : undefined}
                        onAddOutputMappingColumn={
                            activeNode.depth === 0 ? onAddOutputMappingColumn : undefined
                        }
                        onRemoveExtraColumn={
                            activeNode.depth === 0 ? onRemoveExtraColumn : undefined
                        }
                        newColumnKeys={activeNode.depth === 0 ? newColumnKeys : []}
                        incomingMappings={
                            activeNode.depth > 0
                                ? activeIncomingConnection?.inputMappings
                                : undefined
                        }
                        sourceEntityLabel={
                            activeNode.depth > 0 ? sourceNode?.entity.label : undefined
                        }
                        onEditMappings={
                            activeNode.depth > 0 && activeIncomingConnection
                                ? () => handleOpenMappingModal(activeIncomingConnection.id)
                                : undefined
                        }
                        loadableId={activeNode.depth === 0 ? loadableId : undefined}
                        showOutputMappings={activeNode.depth === 0 ? showOutputMappings : false}
                    />
                )}
            </div>

            {/* Downstream Connections Summary (for primary node) */}
            {activeNode?.depth === 0 && downstreamConnections.length > 0 && (
                <div className="border-t border-gray-200 px-4 py-2 bg-gray-50">
                    <div className="flex items-center gap-2 mb-2">
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Output Receivers
                        </Text>
                        <Tag className="m-0">{downstreamConnections.length}</Tag>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {downstreamConnections.map((conn) => {
                            const targetNode = nodes.find((n) => n.id === conn.targetNodeId)
                            if (!targetNode) return null

                            const hasInvalidMappings = conn.inputMappings.some(
                                (m) => m.status !== "valid",
                            )

                            return (
                                <Tag
                                    key={conn.id}
                                    color={hasInvalidMappings ? "orange" : "green"}
                                    className="cursor-pointer m-0"
                                    onClick={() => handleActiveNodeChange(targetNode.id)}
                                >
                                    <div className="flex items-center gap-1">
                                        {getEntityIcon(targetNode.entity.type)}
                                        {targetNode.entity.label}
                                    </div>
                                </Tag>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Input Mapping Modal is rendered in PlaygroundContent to avoid duplicate modals */}
        </div>
    )
})
