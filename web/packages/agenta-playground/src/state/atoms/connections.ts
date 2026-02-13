/**
 * Output Connection Atoms
 *
 * State for managing connections between nodes in the playground DAG.
 */

import {atom, type PrimitiveAtom} from "jotai"
import {atomFamily} from "jotai-family"

import type {OutputConnection} from "../types"

// ============================================================================
// OUTPUT CONNECTION STATE ATOMS
// ============================================================================

/**
 * All output connections in the playground
 */
export const outputConnectionsAtom = atom<OutputConnection[]>([]) as PrimitiveAtom<
    OutputConnection[]
>

/**
 * Get connections by source node ID
 */
export const connectionsBySourceAtomFamily = atomFamily((sourceNodeId: string) =>
    atom((get) => {
        const connections = get(outputConnectionsAtom)
        return connections.filter((c) => c.sourceNodeId === sourceNodeId)
    }),
)

/**
 * Get connections by target node ID
 */
export const connectionsByTargetAtomFamily = atomFamily((targetNodeId: string) =>
    atom((get) => {
        const connections = get(outputConnectionsAtom)
        return connections.filter((c) => c.targetNodeId === targetNodeId)
    }),
)
