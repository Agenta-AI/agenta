/**
 * Playground Controller
 *
 * Provides a unified API for managing playground nodes, modal state,
 * and related operations.
 *
 * ## Usage
 *
 * ```typescript
 * import { playgroundController } from '@agenta/playground'
 *
 * // Selectors (functions that return atoms)
 * const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
 * const primaryNode = useAtomValue(useMemo(() => playgroundController.selectors.primaryNode(), []))
 *
 * // Dispatch for standard actions
 * const dispatch = useSetAtom(playgroundController.dispatch)
 * dispatch({ type: 'selectNode', nodeId: 'node-123' })
 *
 * // Compound actions for multi-step operations
 * const addPrimary = useSetAtom(playgroundController.actions.addPrimaryNode)
 * addPrimary({ type: 'appRevision', id: 'rev-123', label: 'My Revision' })
 * ```
 */

import {atom} from "jotai"

import {
    playgroundNodesAtom,
    selectedNodeIdAtom,
    primaryNodeAtom,
    hasMultipleNodesAtom,
    connectedTestsetAtom,
    extraColumnsAtom,
    testsetModalOpenAtom,
    mappingModalOpenAtom,
    editingConnectionIdAtom,
    playgroundDispatchAtom,
} from "../atoms/playground"
import type {EntitySelection, PlaygroundNode, RunnableType} from "../types"

// Import loadable state from entities (stays there due to entity dependencies)
import {loadableStateAtomFamily} from "@agenta/entities/runnable"

// ============================================================================
// COMPOUND ACTIONS
// ============================================================================

/**
 * Generate a default local testset name from entity label and current date
 */
function generateLocalTestsetName(entityLabel?: string): string {
    const date = new Date()
    const dateStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    })
    const timeStr = date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
    })
    const baseName = entityLabel || "Local"
    return `${baseName} - ${dateStr}, ${timeStr}`
}

/**
 * Add a primary node (first runnable in the playground)
 *
 * This compound action:
 * 1. Creates the playground node
 * 2. Links the loadable to the runnable (columns are then derived reactively)
 * 3. Sets up a local testset with a generated name
 */
const addPrimaryNodeAtom = atom(null, (get, set, entity: EntitySelection) => {
    const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const node: PlaygroundNode = {
        id: nodeId,
        entityType: entity.type,
        entityId: entity.id,
        label: entity.label,
        depth: 0,
    }

    // Reset state and add the primary node
    set(playgroundNodesAtom, [node])
    set(selectedNodeIdAtom, nodeId)

    // Set up local testset with generated name from entity label
    const localTestsetName = generateLocalTestsetName(entity.label)
    set(connectedTestsetAtom, {
        id: null, // null id indicates it's a local (unsaved) testset
        name: localTestsetName,
    })

    // Link the loadable to the runnable
    // This triggers reactive column derivation from runnable's inputSchema
    const loadableId = `testset:${entity.type}:${entity.id}`
    const loadableState = get(loadableStateAtomFamily(loadableId))

    console.log("[addPrimaryNode] Linking loadable to runnable", {
        loadableId,
        runnableType: entity.type,
        runnableId: entity.id,
        localTestsetName,
    })

    set(loadableStateAtomFamily(loadableId), {
        ...loadableState,
        linkedRunnableType: entity.type as RunnableType,
        linkedRunnableId: entity.id,
    })

    return nodeId
})

/**
 * Add a downstream node (receiver of output from another node)
 */
const addDownstreamNodeAtom = atom(
    null,
    (get, set, params: {sourceNodeId: string; entity: EntitySelection}) => {
        const {sourceNodeId, entity} = params
        const nodes = get(playgroundNodesAtom)

        // Find source node to determine depth
        const sourceNode = nodes.find((n) => n.id === sourceNodeId)
        if (!sourceNode) return null

        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const node: PlaygroundNode = {
            id: nodeId,
            entityType: entity.type,
            entityId: entity.id,
            label: entity.label,
            depth: sourceNode.depth + 1,
        }

        set(playgroundNodesAtom, [...nodes, node])

        return {
            nodeId,
            sourceNodeId,
        }
    },
)

/**
 * Remove a node and return removed connection IDs
 */
const removeNodeAtom = atom(null, (get, set, nodeId: string): string[] => {
    const nodes = get(playgroundNodesAtom)
    const nodeIndex = nodes.findIndex((n) => n.id === nodeId)

    if (nodeIndex === -1) return []

    // If removing primary node, reset everything
    if (nodeIndex === 0) {
        set(playgroundNodesAtom, [])
        set(selectedNodeIdAtom, null)
        return ["__clear_all__"]
    }

    // Remove just this node
    set(
        playgroundNodesAtom,
        nodes.filter((n) => n.id !== nodeId),
    )

    // Update selection if needed
    const currentSelection = get(selectedNodeIdAtom)
    if (currentSelection === nodeId) {
        set(selectedNodeIdAtom, nodes[0]?.id ?? null)
    }

    return [nodeId]
})

/**
 * Change the primary node (swap the first runnable)
 *
 * This compound action:
 * 1. Updates the playground node
 * 2. Links the loadable to the new runnable
 * 3. Updates the local testset name if not connected to a remote testset
 */
const changePrimaryNodeAtom = atom(null, (get, set, entity: EntitySelection) => {
    const nodes = get(playgroundNodesAtom)

    if (nodes.length === 0) {
        // No nodes, just add as primary
        return set(addPrimaryNodeAtom, entity)
    }

    // Update the primary node in place
    const nodeId = nodes[0].id
    const updatedNode: PlaygroundNode = {
        ...nodes[0],
        entityType: entity.type,
        entityId: entity.id,
        label: entity.label,
    }

    set(playgroundNodesAtom, [updatedNode, ...nodes.slice(1)])

    // Update local testset name if not connected to a remote testset
    const currentTestset = get(connectedTestsetAtom)
    if (!currentTestset?.id) {
        // Local testset - update name based on new entity
        const localTestsetName = generateLocalTestsetName(entity.label)
        set(connectedTestsetAtom, {
            id: null,
            name: localTestsetName,
        })
    }

    // Link the loadable to the new runnable
    const loadableId = `testset:${entity.type}:${entity.id}`
    const loadableState = get(loadableStateAtomFamily(loadableId))

    console.log("[changePrimaryNode] Linking loadable to new runnable", {
        loadableId,
        runnableType: entity.type,
        runnableId: entity.id,
    })

    set(loadableStateAtomFamily(loadableId), {
        ...loadableState,
        linkedRunnableType: entity.type as RunnableType,
        linkedRunnableId: entity.id,
    })

    return nodeId
})

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const playgroundController = {
    /**
     * Selectors - functions that return atoms
     * Usage: useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
     */
    selectors: {
        /** All nodes in the playground */
        nodes: () => playgroundNodesAtom,

        /** Currently selected node ID */
        selectedNodeId: () => selectedNodeIdAtom,

        /** Primary node (first node) */
        primaryNode: () => primaryNodeAtom,

        /** Whether there are multiple nodes */
        hasMultipleNodes: () => hasMultipleNodesAtom,

        /** Connected testset info */
        connectedTestset: () => connectedTestsetAtom,

        /** Extra columns added by user */
        extraColumns: () => extraColumnsAtom,

        /** Testset modal open state */
        testsetModalOpen: () => testsetModalOpenAtom,

        /** Mapping modal open state */
        mappingModalOpen: () => mappingModalOpenAtom,

        /** ID of connection being edited */
        editingConnectionId: () => editingConnectionIdAtom,
    },

    /**
     * Compound actions for multi-step operations
     * Usage: const addPrimary = useSetAtom(playgroundController.actions.addPrimaryNode)
     */
    actions: {
        /** Add a primary node (first runnable) */
        addPrimaryNode: addPrimaryNodeAtom,

        /** Add a downstream node (output receiver) */
        addDownstreamNode: addDownstreamNodeAtom,

        /** Remove a node */
        removeNode: removeNodeAtom,

        /** Change the primary node */
        changePrimaryNode: changePrimaryNodeAtom,
    },

    /**
     * Dispatch for standard actions
     * Usage: const dispatch = useSetAtom(playgroundController.dispatch)
     */
    dispatch: playgroundDispatchAtom,
}
