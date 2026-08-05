/**
 * Connection graph helpers
 *
 * Pure functions for reasoning about the playground DAG's output connections.
 */

import type {OutputConnection, PlaygroundNode} from "../types"

/**
 * Keep only connections whose source and target both reference existing nodes.
 *
 * Used when the primary node is swapped in place (its `id` is preserved), so
 * downstream chains sourced from it stay valid and must not be wiped. Any
 * connection pointing at a node that no longer exists is dropped.
 */
export function pruneDanglingConnections(
    connections: OutputConnection[],
    nodes: PlaygroundNode[],
): OutputConnection[] {
    const nodeIds = new Set(nodes.map((node) => node.id))
    return connections.filter(
        (connection) =>
            nodeIds.has(connection.sourceNodeId) && nodeIds.has(connection.targetNodeId),
    )
}
