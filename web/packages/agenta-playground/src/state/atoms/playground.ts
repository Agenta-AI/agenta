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
 * Entity ID anchoring the loadable for the current playground session.
 *
 * The "anchor" is the depth-0 entity whose `loadableId`
 * (`testset:<type>:<id>`) is treated as the canonical loadable for the
 * playground. It's intentionally stateful (not a pure derivation from
 * `playgroundNodesAtom`) so that reordering columns in comparison mode
 * doesn't flip which entity owns the loadable — keep the original anchor
 * as long as it's still present.
 *
 * Replaces the prior `let _loadableAnchorEntityId` module variable that was
 * mutated inside `derivedLoadableIdAtom`'s getter — a Jotai anti-pattern
 * that produced silent, non-deterministic anchor flips across surface
 * transitions (app playground ↔ evaluator drawer ↔ traces).
 *
 * Writes to this atom are gated through `reanchorLoadableAtom`; direct
 * sets are discouraged. See `reanchorLoadableAtom` for the policy.
 */
export const loadableAnchorEntityIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>

/**
 * Recompute `loadableAnchorEntityIdAtom` from the current
 * `playgroundNodesAtom`. The policy:
 *
 *   1. If there are no depth-0 nodes → clear the anchor.
 *   2. If the current anchor still matches a depth-0 node → keep it
 *      (preserves stability across reordering and downstream-node-only
 *      changes).
 *   3. Otherwise → adopt the first depth-0 node as the new anchor.
 *
 * Call this immediately after any write to `playgroundNodesAtom`. The
 * controller's higher-level node actions (addPrimaryNode, addDownstreamNode,
 * removeNode, setEntityIds, resetAll, …) and the legacy
 * `playgroundDispatchAtom` reducers both invoke this.
 */
export const reanchorLoadableAtom = atom(null, (get, set) => {
    const nodes = get(playgroundNodesAtom)
    const rootNodes = nodes.filter((n) => n.depth === 0)

    if (rootNodes.length === 0) {
        if (get(loadableAnchorEntityIdAtom) !== null) {
            set(loadableAnchorEntityIdAtom, null)
        }
        return
    }

    const currentAnchor = get(loadableAnchorEntityIdAtom)
    if (currentAnchor && rootNodes.some((n) => n.entityId === currentAnchor)) {
        // Anchor still valid; keep it.
        return
    }

    set(loadableAnchorEntityIdAtom, rootNodes[0].entityId)
})

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
 * Whether there are multiple nodes (chain mode)
 */
export const hasMultipleNodesAtom = atom((get) => {
    const nodes = get(playgroundNodesAtom)
    return nodes.length > 1
})

/**
 * The primary (first) node in the playground, or null if empty.
 */
export const primaryNodeAtom = atom((get) => {
    const nodes = get(playgroundNodesAtom)
    return nodes.length > 0 ? nodes[0] : null
})

/**
 * The entity ID of the primary node, or null if no nodes.
 */
export const primaryEntityIdAtom = atom((get) => get(playgroundNodesAtom)[0]?.entityId ?? null)

/**
 * Entity IDs from primary-level nodes only (depth 0).
 * Downstream chain nodes (e.g. evaluators at depth > 0) are excluded
 * so they don't trigger comparison mode.
 */
export const entityIdsAtom = atom((get) =>
    get(playgroundNodesAtom)
        .filter((n) => n.depth === 0)
        .map((n) => n.entityId),
)

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
            set(reanchorLoadableAtom)
            break
        }
        case "removeNode": {
            const nodes = get(playgroundNodesAtom)
            set(
                playgroundNodesAtom,
                nodes.filter((n) => n.id !== action.nodeId),
            )
            set(reanchorLoadableAtom)
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
            set(reanchorLoadableAtom)
            break
        }
    }
})
