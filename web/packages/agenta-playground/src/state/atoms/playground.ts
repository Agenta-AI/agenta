/**
 * Playground State Atoms
 *
 * Core playground state: nodes, selection, modals, and testset connection.
 */

import {atom, type PrimitiveAtom} from "jotai"

import type {PlaygroundNode, PlaygroundAction, ConnectedTestset, ExtraColumn} from "../types"

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const defaultLocalTestsetName = "Untitled Testset"

// ============================================================================
// PLAYGROUND STATE ATOMS
// ============================================================================

/**
 * All nodes in the playground DAG
 */
export const playgroundNodesAtom = atom<PlaygroundNode[]>([]) as PrimitiveAtom<PlaygroundNode[]>

/**
 * Currently selected node ID
 */
export const selectedNodeIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>

/**
 * Connected testset info
 */
export const connectedTestsetAtom = atom<ConnectedTestset | null>(
    null,
) as PrimitiveAtom<ConnectedTestset | null>

/**
 * Extra columns added by the user
 */
export const extraColumnsAtom = atom<ExtraColumn[]>([]) as PrimitiveAtom<ExtraColumn[]>

/**
 * Testset modal open state
 */
export const testsetModalOpenAtom = atom<boolean>(false) as PrimitiveAtom<boolean>

/**
 * Mapping modal open state
 */
export const mappingModalOpenAtom = atom<boolean>(false) as PrimitiveAtom<boolean>

/**
 * ID of connection being edited in mapping modal
 */
export const editingConnectionIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>

// ============================================================================
// DERIVED PLAYGROUND ATOMS
// ============================================================================

/**
 * Primary node (first node / root of DAG)
 */
export const primaryNodeAtom = atom((get) => {
    const nodes = get(playgroundNodesAtom)
    return nodes.length > 0 ? nodes[0] : null
})

/**
 * Whether there are multiple nodes (chain mode)
 */
export const hasMultipleNodesAtom = atom((get) => {
    const nodes = get(playgroundNodesAtom)
    return nodes.length > 1
})

// ============================================================================
// PLAYGROUND DISPATCH ATOM
// ============================================================================

/**
 * Dispatch action to modify playground state
 */
export const playgroundDispatchAtom = atom(null, (get, set, action: PlaygroundAction) => {
    switch (action.type) {
        case "addNode": {
            const nodes = get(playgroundNodesAtom)
            set(playgroundNodesAtom, [...nodes, action.node])
            break
        }
        case "removeNode": {
            const nodes = get(playgroundNodesAtom)
            set(
                playgroundNodesAtom,
                nodes.filter((n) => n.id !== action.nodeId),
            )
            break
        }
        case "selectNode": {
            set(selectedNodeIdAtom, action.nodeId)
            break
        }
        case "setConnectedTestset": {
            set(connectedTestsetAtom, {
                id: action.id,
                name: action.name ?? defaultLocalTestsetName,
            })
            break
        }
        case "clearConnectedTestset": {
            set(connectedTestsetAtom, null)
            break
        }
        case "addExtraColumn": {
            const cols = get(extraColumnsAtom)
            set(extraColumnsAtom, [...cols, {key: action.key, name: action.name, type: "string"}])
            break
        }
        case "removeExtraColumn": {
            const cols = get(extraColumnsAtom)
            set(
                extraColumnsAtom,
                cols.filter((c) => c.key !== action.key),
            )
            break
        }
        case "openModal": {
            if (action.modal === "testset") {
                set(testsetModalOpenAtom, true)
            } else if (action.modal === "mapping") {
                set(mappingModalOpenAtom, true)
                if (action.connectionId) {
                    set(editingConnectionIdAtom, action.connectionId)
                }
            }
            break
        }
        case "closeModal": {
            if (action.modal === "testset") {
                set(testsetModalOpenAtom, false)
            } else if (action.modal === "mapping") {
                set(mappingModalOpenAtom, false)
                set(editingConnectionIdAtom, null)
            }
            break
        }
        case "reset": {
            set(playgroundNodesAtom, [])
            set(selectedNodeIdAtom, null)
            set(connectedTestsetAtom, null)
            set(extraColumnsAtom, [])
            set(testsetModalOpenAtom, false)
            set(mappingModalOpenAtom, false)
            set(editingConnectionIdAtom, null)
            break
        }
    }
})
