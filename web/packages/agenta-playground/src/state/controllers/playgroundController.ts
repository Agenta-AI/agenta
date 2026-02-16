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

import {evaluatorMolecule} from "@agenta/entities/evaluator"
import {evaluatorRevisionMolecule} from "@agenta/entities/evaluatorRevision"
import {fetchOssRevisionById} from "@agenta/entities/legacyAppRevision"
import {loadableController, snapshotAdapterRegistry} from "@agenta/entities/runnable"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {outputConnectionsAtom} from "../atoms/connections"
import {
    playgroundNodesAtom,
    selectedNodeIdAtom,
    hasMultipleNodesAtom,
    entityIdsAtom,
    connectedTestsetAtom,
    extraColumnsAtom,
    testsetModalOpenAtom,
    mappingModalOpenAtom,
    editingConnectionIdAtom,
    playgroundDispatchAtom,
} from "../atoms/playground"
import {duplicateSessionResponsesWithContextAtom} from "../chat"
import type {
    AppRevisionCreateVariantPayload,
    AppRevisionCommitPayload,
    AppRevisionCrudResult,
} from "../context"
import {
    displayedEntityIdsAtom,
    resolvedEntityIdsAtom,
    isComparisonViewAtom,
    playgroundLayoutAtom,
    playgroundRevisionsReadyAtom,
    playgroundStatusAtom,
    schemaInputKeysAtom,
} from "../execution/displayedEntities"
import {derivedLoadableIdAtom, inputVariableNamesAtom} from "../execution/selectors"
import type {EntitySelection, PlaygroundNode, RunnableType} from "../types"

import {getRunnableBridge} from "./runnableBridgeAccess"
import {getRunnableTypeResolver} from "./urlSnapshotController"

// Import loadable state from entities (stays there due to entity dependencies)

// ============================================================================
// COMPOUND ACTION PAYLOAD TYPES
// ============================================================================

/**
 * Payload for connecting to a testset (load mode)
 */
interface ConnectToTestsetPayload {
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
interface ImportTestcasesPayload {
    loadableId: string
    testcases: Record<string, unknown>[]
}

/**
 * Payload for adding a row with testset initialization
 */
interface AddRowWithInitPayload {
    loadableId: string
    data?: Record<string, unknown>
    entityLabel?: string
}

/**
 * Payload for adding/removing extra columns
 */
interface ExtraColumnPayload {
    loadableId: string
    key: string
    name?: string
}

/**
 * Payload for adding output mapping columns
 */
interface OutputMappingColumnPayload {
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
    set(outputConnectionsAtom, [])

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
        _onSelectionChange?.(get(entityIdsAtom), [])

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
    const removedEntityId = nodes[nodeIndex]?.entityId

    // If removing primary node, reset everything
    if (nodeIndex === 0) {
        set(playgroundNodesAtom, [])
        set(selectedNodeIdAtom, null)
        set(outputConnectionsAtom, [])
        _onSelectionChange?.([], removedEntityId ? [removedEntityId] : [])
        return ["__clear_all__"]
    }

    // Remove just this node
    set(
        playgroundNodesAtom,
        nodes.filter((n) => n.id !== nodeId),
    )
    set(
        outputConnectionsAtom,
        get(outputConnectionsAtom).filter(
            (connection) =>
                connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId,
        ),
    )

    // Update selection if needed
    const currentSelection = get(selectedNodeIdAtom)
    if (currentSelection === nodeId) {
        set(selectedNodeIdAtom, nodes[0]?.id ?? null)
    }

    _onSelectionChange?.(get(entityIdsAtom), removedEntityId ? [removedEntityId] : [])

    return [nodeId]
})

/**
 * Connect a downstream node, replacing any existing node of the same entity type.
 *
 * This compound action atomically:
 * 1. Removes any existing downstream node matching the entity type
 * 2. Adds the new downstream node
 * 3. Creates the output connection
 *
 * Use this instead of manually calling addDownstreamNode + addConnection
 * to keep the UI decoupled from state management details.
 */
const connectDownstreamNodeAtom = atom(
    null,
    (
        get,
        set,
        params: {sourceNodeId: string; entity: EntitySelection},
    ): {nodeId: string; sourceNodeId: string} | null => {
        const {sourceNodeId, entity} = params
        const nodes = get(playgroundNodesAtom)

        // Remove any existing downstream node of the same entity type
        const existing = nodes.find((n) => n.depth > 0 && n.entityType === entity.type)
        if (existing) {
            set(removeNodeAtom, existing.id)
        }

        // Add the new downstream node
        const result = set(addDownstreamNodeAtom, {sourceNodeId, entity})
        if (!result) return null

        // Create the connection
        const connections = get(outputConnectionsAtom)
        const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        set(outputConnectionsAtom, [
            ...connections,
            {
                id: connectionId,
                sourceNodeId: result.sourceNodeId,
                targetNodeId: result.nodeId,
                sourceOutputKey: "output",
                inputMappings: [],
            },
        ])

        // For evaluator entities, eagerly subscribe to the appropriate molecule's
        // query atom so the per-ID fetch fires immediately. We subscribe directly
        // to the molecule instead of runnableBridge.data() because the bridge
        // probes ALL registered molecules in order, which would trigger spurious
        // fetches on unrelated molecules (e.g. legacyAppRevision).
        if (entity.type === "evaluator" || entity.type === "evaluatorRevision") {
            const store = getDefaultStore()
            const molecule =
                entity.type === "evaluatorRevision" ? evaluatorRevisionMolecule : evaluatorMolecule
            const unsub = store.sub(molecule.selectors.data(entity.id), () => {})
            // Unsubscribe after a generous window — the query cache keeps the data alive.
            setTimeout(() => unsub(), 60_000)
        }

        return result
    },
)

/**
 * Disconnect all downstream nodes of a given entity type.
 */
const disconnectDownstreamNodeAtom = atom(null, (get, set, entityType: string) => {
    const nodes = get(playgroundNodesAtom)
    const toRemove = nodes.filter((n) => n.depth > 0 && n.entityType === entityType)
    for (const node of toRemove) {
        set(removeNodeAtom, node.id)
    }
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
    set(outputConnectionsAtom, [])

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
 * Reset playground state and clear output connections.
 */
const resetAllAtom = atom(null, (_get, set) => {
    set(playgroundDispatchAtom, {type: "reset"})
    set(outputConnectionsAtom, [])
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
    const rootNode = get(playgroundNodesAtom).find((n) => n.depth === 0)
    if (!rootNode) return

    // 1. Call loadable disconnect action
    set(loadableController.actions.disconnect, loadableId)

    // 2. Generate and set local testset name
    const localTestsetName = generateLocalTestsetName(rootNode.label)
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
// QUERY INVALIDATION
// ============================================================================

/**
 * Invalidate all playground-related TanStack Query caches and force refetch.
 *
 * This covers both legacy OSS query keys and entity package query keys
 * (used by appRevisionsWithDraftsAtomFamily). Also bumps the entity
 * revision cache version so cache-derived atoms re-evaluate.
 */
const invalidateQueriesAtom = atom(null, async () => {
    const {queryClient} = await import("@agenta/shared/api")
    const {legacyAppRevisionMolecule} = await import("@agenta/entities/legacyAppRevision")

    const queryKeys = [
        ["variants"],
        ["variantRevisions"],
        ["appVariants"],
        ["appVariantRevisions"],
        ["oss-variants-for-selection"],
        ["oss-revisions-for-selection"],
    ]

    // Invalidate to mark as stale
    await Promise.all(
        queryKeys.map((queryKey) => queryClient.invalidateQueries({queryKey, exact: false})),
    )

    // Refetch with type: 'all' to bypass cache
    await Promise.all(
        queryKeys.map((queryKey) =>
            queryClient.refetchQueries({queryKey, type: "all", exact: false}),
        ),
    )

    // Bump the revision cache version so cache-derived atoms re-evaluate
    legacyAppRevisionMolecule.set.invalidateCache()
})

// ============================================================================
// CRUD ACTIONS (delegate to runnableBridge entity-level actions)
// ============================================================================

const controllerCreateVariantAtom = atom(
    null,
    async (_get, set, payload: AppRevisionCreateVariantPayload): Promise<AppRevisionCrudResult> => {
        const bridge = getRunnableBridge()
        return set(bridge.crud.createVariant, payload)
    },
)

const controllerCommitRevisionAtom = atom(
    null,
    async (get, set, payload: AppRevisionCommitPayload): Promise<AppRevisionCrudResult> => {
        const bridge = getRunnableBridge()
        const runnableData = get(bridge.selectors.data(payload.revisionId)) as
            | ({configuration?: Record<string, unknown>; variantId?: string} & Record<
                  string,
                  unknown
              >)
            | null

        // Resolve variantId: payload → bridge data → direct API fetch
        let variantId = payload.variantId ?? runnableData?.variantId
        if (!variantId) {
            const projectId = get(projectIdAtom)
            if (projectId) {
                const fetched = await fetchOssRevisionById(payload.revisionId, projectId)
                variantId = fetched?.variantId
            }
        }

        return set(bridge.crud.commitRevision, {
            ...payload,
            commitMessage: payload.commitMessage ?? payload.note,
            parameters: payload.parameters ?? runnableData?.configuration ?? {},
            variantId,
        })
    },
)

const controllerDeleteRevisionAtom = atom(
    null,
    async (_get, set, revisionId: string): Promise<AppRevisionCrudResult> => {
        const bridge = getRunnableBridge()
        return set(bridge.crud.deleteRevision, revisionId)
    },
)

// ============================================================================
// SELECTION CHANGE CALLBACK
// ============================================================================

/**
 * Callback invoked after any controller action mutates the entity selection.
 * OSS registers this to handle URL sync, drawer state, and entity cleanup.
 *
 * @param entityIds - The new set of displayed entity IDs after the mutation
 * @param removed  - Entity IDs that were removed (if any)
 */
type SelectionChangeCallback = (entityIds: string[], removed: string[]) => void

let _onSelectionChange: SelectionChangeCallback | null = null

/**
 * Register a callback for selection change side-effects (URL sync, drawer state, etc.).
 * Call from the OSS/EE layer during initialization.
 */
export function setOnSelectionChangeCallback(cb: SelectionChangeCallback | null): void {
    _onSelectionChange = cb
}

/** @internal */
export function getOnSelectionChangeCallback(): SelectionChangeCallback | null {
    return _onSelectionChange
}

// ============================================================================
// SELECTION ACTIONS
// ============================================================================

/**
 * Set entity IDs directly (replaces the old OSS selectedVariantsAtom bridge).
 * Takes string[] or updater function, creates/reuses PlaygroundNode objects.
 */
const setEntityIdsAtom = atom(null, (get, set, next: string[] | ((prev: string[]) => string[])) => {
    const currentNodes = get(playgroundNodesAtom)
    const currentIds = currentNodes.map((n) => n.entityId)
    const rawValue = typeof next === "function" ? next(currentIds) : next
    const seen = new Set<string>()
    const newIds = rawValue.filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
    })
    const existingByEntityId = new Map(currentNodes.map((n) => [n.entityId, n]))
    const resolver = getRunnableTypeResolver()
    const newNodes: PlaygroundNode[] = newIds.map((entityId) => {
        const existing = existingByEntityId.get(entityId)
        if (existing) return existing
        return {
            id: `node-${entityId}`,
            entityType: resolver?.getType(entityId) ?? "legacyAppRevision",
            entityId,
            label: entityId,
            depth: 0,
        }
    })
    set(playgroundNodesAtom, newNodes)

    // Ensure primary runnable is linked so loadable-derived columns/rows
    // (including initial variable row) are initialized for the current selection.
    const primary = newNodes[0]
    if (primary) {
        const loadableId = `testset:${primary.entityType}:${primary.entityId}`
        set(
            loadableController.actions.linkToRunnable,
            loadableId,
            primary.entityType as RunnableType,
            primary.entityId,
        )
    }
})

/**
 * Remove an entity from the displayed selection.
 * Notifies the registered selection change callback for OSS-specific side-effects
 * (URL sync, drawer state, entity cleanup).
 */
const removeEntityAtom = atom(null, (get, set, entityId: string) => {
    const current = get(entityIdsAtom)
    let updated = current.filter((id) => id !== entityId)

    // Prevent empty playground: if removing the last entity and it's a local draft,
    // fall back to its source revision
    if (updated.length === 0) {
        const resolver = getRunnableTypeResolver()
        const runnableType = resolver?.getType(entityId)
        if (runnableType) {
            const adapter = snapshotAdapterRegistry.get(runnableType)
            if (adapter?.isLocalDraftId(entityId)) {
                const sourceId = adapter.extractSourceId(entityId)
                if (sourceId) {
                    updated = [sourceId]
                }
            }
        }
    }

    set(setEntityIdsAtom, updated)
    _onSelectionChange?.(updated, [entityId])
})

/**
 * Switch one entity for another in the displayed selection.
 * Handles both single and comparison mode. Duplicates chat history
 * from the old entity to the new one.
 */
const switchEntityAtom = atom(
    null,
    (get, set, {currentEntityId, newEntityId}: {currentEntityId: string; newEntityId: string}) => {
        const current = get(entityIdsAtom)
        const updated =
            current.length > 1
                ? current.map((id) => (id === currentEntityId ? newEntityId : id))
                : [newEntityId]

        set(duplicateSessionResponsesWithContextAtom, {
            sourceRevisionId: currentEntityId,
            targetRevisionId: newEntityId,
        })
        set(setEntityIdsAtom, updated)
        _onSelectionChange?.(updated, [currentEntityId])
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

        /** Entity IDs from all nodes */
        entityIds: () => entityIdsAtom,

        /** Loadable ID for root node */
        loadableId: () => derivedLoadableIdAtom,

        /** Displayed entity IDs (validated against revisions) */
        displayedEntityIds: () => displayedEntityIdsAtom,

        /** Resolved entity IDs (ready for render, excludes pending IDs) */
        resolvedEntityIds: () => resolvedEntityIdsAtom,

        /** Whether comparison mode is active (validated) */
        isComparisonView: () => isComparisonViewAtom,

        /** Composite layout state */
        playgroundLayout: () => playgroundLayoutAtom,

        /** Whether playground revisions have finished loading */
        revisionsReady: () => playgroundRevisionsReadyAtom,

        /** Schema-derived input keys */
        schemaInputKeys: () => schemaInputKeysAtom,

        /** High-level playground lifecycle status: "idle" | "loading" | "ready" | "empty" */
        status: () => playgroundStatusAtom,

        /** Variable names derived from entity input ports */
        inputVariableNames: () => inputVariableNamesAtom,
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

        /** Connect a downstream node, replacing any existing node of the same type */
        connectDownstreamNode: connectDownstreamNodeAtom,

        /** Disconnect all downstream nodes of a given entity type */
        disconnectDownstreamNode: disconnectDownstreamNodeAtom,

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

        /** Set entity IDs (replaces OSS selectedVariantsAtom bridge) */
        setEntityIds: setEntityIdsAtom,

        /** Remove an entity from the displayed selection */
        removeEntity: removeEntityAtom,

        /** Switch one entity for another in the displayed selection */
        switchEntity: switchEntityAtom,

        /** Invalidate all playground-related query caches and force refetch */
        invalidateQueries: invalidateQueriesAtom,

        // CRUD actions (delegate to registered provider)
        /** Create a new variant */
        createVariant: controllerCreateVariantAtom,

        /** Commit (save) a revision */
        commitRevision: controllerCommitRevisionAtom,

        /** Delete a revision */
        deleteRevision: controllerDeleteRevisionAtom,

        /** Reset playground state and clear all output connections */
        resetAll: resetAllAtom,

        /** Duplicate session responses from one entity to another */
        duplicateSessionResponses: duplicateSessionResponsesWithContextAtom,
    },

    /**
     * Dispatch for standard actions
     * Usage: const dispatch = useSetAtom(playgroundController.dispatch)
     */
    dispatch: playgroundDispatchAtom,
}
