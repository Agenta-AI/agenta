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

import {loadableController} from "@agenta/entities/runnable"
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

// ============================================================================
// COMPOUND ACTION PAYLOAD TYPES
// ============================================================================

/**
 * Payload for connecting to a testset (load mode)
 */
export interface ConnectToTestsetPayload {
    loadableId: string
    revisionId: string
    testcases: ({id?: string} & Record<string, unknown>)[]
    testsetName?: string
    testsetId?: string | null
    revisionVersion?: number | null
}

/**
 * Payload for importing testcases (import mode - no connection)
 */
export interface ImportTestcasesPayload {
    loadableId: string
    testcases: Record<string, unknown>[]
}

/**
 * Payload for adding a row with testset initialization
 */
export interface AddRowWithInitPayload {
    loadableId: string
    data?: Record<string, unknown>
    entityLabel?: string
}

/**
 * Payload for adding/removing extra columns
 */
export interface ExtraColumnPayload {
    loadableId: string
    key: string
    name?: string
}

/**
 * Payload for adding output mapping columns
 */
export interface OutputMappingColumnPayload {
    loadableId: string
    name: string
}

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
 * 3. Creates an initial empty row for testcases
 * 4. Sets up a local testset with a generated name
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

    // Link the loadable to the runnable and create initial row
    // This triggers reactive column derivation from runnable's inputSchema
    const loadableId = `testset:${entity.type}:${entity.id}`

    // Use loadableController action which handles row creation via testcaseMolecule
    set(
        loadableController.actions.linkToRunnable,
        loadableId,
        entity.type as RunnableType,
        entity.id,
    )

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

    // Link the loadable to the new runnable via controller API
    const loadableId = `testset:${entity.type}:${entity.id}`
    set(
        loadableController.actions.linkToRunnable,
        loadableId,
        entity.type as RunnableType,
        entity.id,
    )

    return nodeId
})

/**
 * Disconnect from testset and reset to local mode
 *
 * This compound action:
 * 1. Calls loadable disconnect (clears connectedSourceId, testcase IDs)
 * 2. Regenerates a local testset name from the primary node's label
 * 3. Creates an initial empty row for testcases
 *
 * This ensures the playground returns to the same state as initial setup.
 */
const disconnectAndResetToLocalAtom = atom(null, (get, set, loadableId: string) => {
    // Get primary node for generating the local testset name
    const primaryNode = get(primaryNodeAtom)
    if (!primaryNode) return

    // 1. Call loadable disconnect action
    set(loadableController.actions.disconnect, loadableId)

    // 2. Generate and set local testset name
    const localTestsetName = generateLocalTestsetName(primaryNode.label)
    set(connectedTestsetAtom, {
        id: null, // null id indicates it's a local (unsaved) testset
        name: localTestsetName,
    })

    // 3. Create an initial empty row via loadableController (uses testcaseMolecule)
    set(loadableController.actions.addRow, loadableId, {})
})

// ============================================================================
// WP1: TESTSET CONNECTION COMPOUND ACTIONS
// ============================================================================

/**
 * Connect to a testset (load mode)
 *
 * This compound action handles the "load" mode of testset selection:
 * 1. Generates a display name from testset name and version
 * 2. Ensures testcases have IDs
 * 3. Calls loadable.connectToSource
 * 4. Updates connectedTestsetAtom with name and id
 *
 * This encapsulates the logic from handleSelectionConfirm in load mode.
 */
const connectToTestsetAtom = atom(null, (get, set, payload: ConnectToTestsetPayload) => {
    const {loadableId, revisionId, testcases, testsetName, testsetId, revisionVersion} = payload

    // Generate display name from testset name and version
    const displayName = testsetName
        ? revisionVersion != null
            ? `${testsetName} v${revisionVersion}`
            : testsetName
        : undefined

    // Ensure testcases have IDs
    const testcasesWithIds = testcases.map((tc, index) => {
        const id = tc.id ?? `testcase-${Date.now()}-${index}`
        return {id, ...tc}
    })

    // Connect to source via loadable controller
    set(
        loadableController.actions.connectToSource,
        loadableId,
        revisionId,
        displayName,
        testcasesWithIds,
    )

    // Update playground's connectedTestset state
    set(connectedTestsetAtom, {
        name: displayName ?? null,
        id: testsetId ?? null,
    })
})

/**
 * Import testcases (import mode - no connection)
 *
 * This compound action handles the "import" mode of testset selection:
 * 1. Imports the testcases as local rows
 * 2. Does NOT update connectedTestset (stays in local mode)
 *
 * This encapsulates the logic from handleSelectionConfirm in import mode.
 */
const importTestcasesAtom = atom(null, (get, set, payload: ImportTestcasesPayload) => {
    const {loadableId, testcases} = payload

    // Import rows via loadable controller (stays in local mode)
    set(loadableController.actions.importRows, loadableId, testcases)
})

// ============================================================================
// WP2: ROW WITH INIT COMPOUND ACTION
// ============================================================================

/**
 * Add a row with local testset initialization
 *
 * This compound action handles the row addition logic:
 * 1. If first row and not connected to remote testset, generates a local testset name
 * 2. Adds the row via loadable controller
 *
 * This encapsulates the logic from handleAddRow in PlaygroundContent.
 */
const addRowWithInitAtom = atom(null, (get, set, payload: AddRowWithInitPayload) => {
    const {loadableId, data, entityLabel} = payload

    // Check if we need to initialize local testset name
    const connectedTestset = get(connectedTestsetAtom)
    const rowCount = get(loadableController.selectors.rowCount(loadableId))

    if (rowCount === 0 && !connectedTestset?.id) {
        // First row in local mode - generate local testset name
        const localTestsetName = generateLocalTestsetName(entityLabel)
        set(connectedTestsetAtom, {
            id: null,
            name: localTestsetName,
        })
    }

    // Add the row via loadable controller
    set(loadableController.actions.addRow, loadableId, data)
})

// ============================================================================
// WP3: EXTRA COLUMN COMPOUND ACTIONS
// ============================================================================

/**
 * Add an extra column (coordinated across playground and loadable state)
 *
 * This compound action:
 * 1. Validates the column key doesn't already exist
 * 2. Updates playground extraColumns state
 * 3. Updates loadable columns via controller
 *
 * This encapsulates the logic from handleAddExtraColumn in PlaygroundContent.
 */
const addExtraColumnAtom = atom(
    null,
    (get, set, payload: ExtraColumnPayload & {existingColumnKeys?: string[]}) => {
        const {loadableId, key, name, existingColumnKeys = []} = payload

        // Validate key doesn't already exist
        const currentExtraColumns = get(extraColumnsAtom)
        const existingKeys = new Set([
            ...existingColumnKeys,
            ...currentExtraColumns.map((c) => c.key),
        ])

        if (existingKeys.has(key)) return false

        // Update playground extraColumns state
        set(playgroundDispatchAtom, {type: "addExtraColumn", key, name: name ?? key})

        // Update loadable columns via controller
        set(loadableController.actions.addColumn, loadableId, {
            key,
            name: name ?? key,
            type: "string",
        })

        return true
    },
)

/**
 * Remove an extra column (coordinated across playground and loadable state)
 *
 * This compound action:
 * 1. Updates playground extraColumns state
 * 2. Updates loadable columns via controller
 *
 * This encapsulates the logic from handleRemoveExtraColumn in PlaygroundContent.
 */
const removeExtraColumnAtom = atom(null, (get, set, payload: ExtraColumnPayload) => {
    const {loadableId, key} = payload

    // Update playground extraColumns state
    set(playgroundDispatchAtom, {type: "removeExtraColumn", key})

    // Update loadable columns via controller
    set(loadableController.actions.removeColumn, loadableId, key)
})

// ============================================================================
// WP4: OUTPUT MAPPING COLUMN COMPOUND ACTION
// ============================================================================

/**
 * Normalize a column name to a key format
 * Converts to lowercase and replaces whitespace with underscores
 */
function normalizeColumnKey(name: string): string {
    return name.toLowerCase().replace(/\s+/g, "_")
}

/**
 * Add an output mapping column (adds to loadable columns only, not to extraColumns)
 *
 * This compound action:
 * 1. Normalizes the column name to a key
 * 2. Validates the column key doesn't already exist
 * 3. Adds the column to loadable via controller
 *
 * This encapsulates the logic from handleAddOutputMappingColumn in PlaygroundContent,
 * following the playground-compound-actions rule.
 */
const addOutputMappingColumnAtom = atom(
    null,
    (get, set, payload: OutputMappingColumnPayload): boolean => {
        const {loadableId, name} = payload
        const key = normalizeColumnKey(name)

        // Get existing column keys for validation using selector pattern
        const columnsAtom = loadableController.selectors.columns(loadableId)
        const columns = get(columnsAtom)
        const extraColumns = get(extraColumnsAtom)
        const existingKeys = new Set([
            ...columns.map((c) => c.key),
            ...extraColumns.map((c) => c.key),
        ])

        // Validate key doesn't already exist
        if (existingKeys.has(key)) return false

        // Add column via loadable controller (not to extraColumns)
        set(loadableController.actions.addColumn, loadableId, {
            key,
            name,
            type: "string",
        })

        return true
    },
)

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

        /** Disconnect from testset and reset to local mode */
        disconnectAndResetToLocal: disconnectAndResetToLocalAtom,

        // WP1: Testset connection actions
        /** Connect to a testset (load mode) */
        connectToTestset: connectToTestsetAtom,

        /** Import testcases (import mode - no connection) */
        importTestcases: importTestcasesAtom,

        // WP2: Row with init action
        /** Add a row with local testset initialization */
        addRowWithInit: addRowWithInitAtom,

        // WP3: Extra column actions
        /** Add an extra column (coordinated) */
        addExtraColumn: addExtraColumnAtom,

        /** Remove an extra column (coordinated) */
        removeExtraColumn: removeExtraColumnAtom,

        // WP4: Output mapping column action
        /** Add an output mapping column (loadable only, not extraColumns) */
        addOutputMappingColumn: addOutputMappingColumnAtom,
    },

    /**
     * Dispatch for standard actions
     * Usage: const dispatch = useSetAtom(playgroundController.dispatch)
     */
    dispatch: playgroundDispatchAtom,
}
