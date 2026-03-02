/**
 * Output Connection Controller
 *
 * Manages connections between nodes in the playground DAG.
 * Handles input mappings from source outputs to target inputs.
 *
 * ## Usage
 *
 * ```typescript
 * import { outputConnectionController } from '@agenta/playground'
 *
 * // Selectors
 * const allConnections = useAtomValue(
 *   useMemo(() => outputConnectionController.selectors.allConnections(), [])
 * )
 * const connectionsBySource = useAtomValue(
 *   outputConnectionController.selectors.connectionsBySource(nodeId)
 * )
 *
 * // Actions
 * const addConnection = useSetAtom(outputConnectionController.actions.addConnection)
 * addConnection({ sourceNodeId, targetNodeId, sourceOutputKey: 'output' })
 *
 * const updateMappings = useSetAtom(outputConnectionController.actions.updateMappings)
 * updateMappings({ connectionId, mappings: [...] })
 * ```
 */

import {atom} from "jotai"

import {
    outputConnectionsAtom,
    connectionsBySourceAtomFamily,
    connectionsByTargetAtomFamily,
} from "../atoms/connections"
import type {OutputConnection, InputMapping} from "../types"

// ============================================================================
// ACTIONS
// ============================================================================

/**
 * Add a new connection between nodes
 */
const addConnectionAtom = atom(
    null,
    (
        get,
        set,
        params: {
            sourceNodeId: string
            targetNodeId: string
            sourceOutputKey?: string
        },
    ) => {
        const {sourceNodeId, targetNodeId, sourceOutputKey = "output"} = params
        const connections = get(outputConnectionsAtom)

        // Check if connection already exists
        const existing = connections.find(
            (c) => c.sourceNodeId === sourceNodeId && c.targetNodeId === targetNodeId,
        )
        if (existing) return existing.id

        const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const connection: OutputConnection = {
            id: connectionId,
            sourceNodeId,
            targetNodeId,
            sourceOutputKey,
            inputMappings: [],
        }

        set(outputConnectionsAtom, [...connections, connection])

        return connectionId
    },
)

/**
 * Remove a connection
 */
const removeConnectionAtom = atom(null, (get, set, params: {connectionId: string}) => {
    const connections = get(outputConnectionsAtom)
    set(
        outputConnectionsAtom,
        connections.filter((c) => c.id !== params.connectionId),
    )
})

/**
 * Clear all connections
 */
const clearConnectionsAtom = atom(null, (_get, set, _params?: Record<string, never>) => {
    set(outputConnectionsAtom, [])
})

/**
 * Update input mappings for a connection
 */
const updateMappingsAtom = atom(
    null,
    (get, set, params: {connectionId: string; mappings: InputMapping[]}) => {
        const {connectionId, mappings} = params
        const connections = get(outputConnectionsAtom)

        set(
            outputConnectionsAtom,
            connections.map((c) => (c.id === connectionId ? {...c, inputMappings: mappings} : c)),
        )
    },
)

/**
 * Remove all connections for a specific node
 */
const removeConnectionsForNodeAtom = atom(null, (get, set, params: {nodeId: string}) => {
    const connections = get(outputConnectionsAtom)
    set(
        outputConnectionsAtom,
        connections.filter(
            (c) => c.sourceNodeId !== params.nodeId && c.targetNodeId !== params.nodeId,
        ),
    )
})

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const outputConnectionController = {
    /**
     * Selectors - functions that return atoms
     */
    selectors: {
        /** All connections */
        allConnections: () => outputConnectionsAtom,

        /** Connections by source node ID */
        connectionsBySource: (sourceNodeId: string) => connectionsBySourceAtomFamily(sourceNodeId),

        /** Connections by target node ID */
        connectionsByTarget: (targetNodeId: string) => connectionsByTargetAtomFamily(targetNodeId),
    },

    /**
     * Actions for modifying connection state
     */
    actions: {
        /** Add a new connection */
        addConnection: addConnectionAtom,

        /** Remove a connection */
        removeConnection: removeConnectionAtom,

        /** Clear all connections */
        clearConnections: clearConnectionsAtom,

        /** Update input mappings for a connection */
        updateMappings: updateMappingsAtom,

        /** Remove all connections for a node */
        removeConnectionsForNode: removeConnectionsForNodeAtom,
    },
}
