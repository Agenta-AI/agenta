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
 * addPrimary({ type: 'legacyAppRevision', id: 'rev-123', label: 'My Revision' })
 * ```
 */

import {
    fetchOssRevisionById,
    createVariantAtom as createLegacyVariantAtom,
    commitRevisionAtom as commitLegacyRevisionAtom,
    deleteRevisionAtom as deleteLegacyRevisionAtom,
} from "@agenta/entities/legacyAppRevision"
import {loadableStateAtomFamily} from "@agenta/entities/loadable"
import {loadableController, snapshotAdapterRegistry} from "@agenta/entities/runnable"
import {registerRunnableTypeHint, clearRunnableTypeHint} from "@agenta/entities/shared"
import {fetchTestcasesPage} from "@agenta/entities/testcase"
import {workflowMolecule} from "@agenta/entities/workflow"
import {commitWorkflowRevisionAtom, archiveWorkflowRevisionAtom} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import type {SnapshotLoadableConnection, SnapshotLocalTestset} from "../../snapshot"
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
import {
    derivedLoadableIdAtom,
    hiddenTestcaseCountAtom,
    inputVariableNamesAtom,
    newTestcaseCountAtom,
    newTestcaseDataHashAtom,
} from "../execution/selectors"
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

function asNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
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
const addPrimaryNodeAtom = atom(
    null,
    (get, set, entity: EntitySelection, options?: {skipInitialRow?: boolean}) => {
        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const node: PlaygroundNode = {
            id: nodeId,
            entityType: entity.type,
            entityId: entity.id,
            label: entity.label,
            depth: 0,
        }

        // Register type hint so runnableBridge skips probing other molecule types
        registerRunnableTypeHint(entity.id, entity.type)

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
        // skipInitialRow defers row creation when a loadable/localTestset restore will follow
        set(
            loadableController.actions.linkToRunnable,
            loadableId,
            entity.type as RunnableType,
            entity.id,
            options?.skipInitialRow ? {skipInitialRow: true} : undefined,
        )

        return nodeId
    },
)

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

        // Register type hint so runnableBridge skips probing other molecule types
        registerRunnableTypeHint(entity.id, entity.type)

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

    // Clear type hint for removed entity
    if (removedEntityId) {
        clearRunnableTypeHint(removedEntityId)
    }

    // If removing primary node, reset everything
    if (nodeIndex === 0) {
        // Clear all hints since we're resetting
        for (const node of nodes) {
            clearRunnableTypeHint(node.entityId)
        }
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
 * Connect a downstream node.
 *
 * This compound action atomically:
 * 1. Adds the new downstream node
 * 2. Creates the output connection
 *
 * Multiple downstream nodes of the same entity type are allowed (e.g. multiple evaluators).
 * If the exact same entity (by ID) is already connected, the call is a no-op.
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

        // Skip if this exact entity is already connected as a downstream node
        const alreadyConnected = nodes.some((n) => n.depth > 0 && n.entityId === entity.id)
        if (alreadyConnected) return null

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

        // For downstream entities, eagerly subscribe to the molecule's query atom
        // so the per-ID fetch fires immediately. We subscribe directly to the
        // molecule instead of runnableBridge.data() because the bridge probes ALL
        // registered molecules in order, which would trigger spurious fetches on
        // unrelated molecules (e.g. legacyAppRevision).
        if (entity.type === "workflow") {
            const store = getDefaultStore()
            const unsub = store.sub(workflowMolecule.selectors.data(entity.id), () => {})
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
 * Disconnect a single downstream node by its node ID.
 */
const disconnectSingleDownstreamNodeAtom = atom(null, (get, set, nodeId: string) => {
    const nodes = get(playgroundNodesAtom)
    const node = nodes.find((n) => n.id === nodeId && n.depth > 0)
    if (node) {
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
// TESTSET CONNECTION RESTORE (URL snapshot hydration)
// ============================================================================

/**
 * Restore a testset connection from a URL snapshot.
 *
 * Called after the primary playground node has been set up (nodes are populated),
 * so derivedLoadableIdAtom returns a valid loadable ID.
 *
 * This compound action:
 * 1. Fetches all testcases for the revision (paginated)
 * 2. Reconnects via the loadable layer (populates query cache, sets testcaseIdsAtom)
 * 3. Updates connectedTestsetAtom for the dropdown display
 */
const restoreLoadableConnectionAtom = atom(
    null,
    async (get, set, loadable: SnapshotLoadableConnection) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return

        const projectId = get(projectIdAtom)
        if (!projectId) return

        // Fetch all testcases for the revision (paginated)
        const allTestcases: ({id: string} & Record<string, unknown>)[] = []
        let cursor: string | null = null
        do {
            const page = await fetchTestcasesPage({
                projectId,
                revisionId: loadable.revisionId,
                cursor,
                limit: 50,
            })
            allTestcases.push(...(page.testcases as ({id: string} & Record<string, unknown>)[]))
            cursor = page.nextCursor
            if (!page.hasMore) break
        } while (cursor)

        // Delegate to the same compound action used for interactive testset connections
        set(connectToTestsetAtom, {
            loadableId,
            revisionId: loadable.revisionId,
            testcases: allTestcases,
            testsetName: loadable.sourceName ?? undefined,
            testsetId: loadable.testsetId ?? undefined,
        })

        // Restore hidden testcase IDs (user's testcase selection filter)
        if (loadable.hiddenTestcaseIds && loadable.hiddenTestcaseIds.length > 0) {
            const state = get(loadableStateAtomFamily(loadableId))
            set(loadableStateAtomFamily(loadableId), {
                ...state,
                hiddenTestcaseIds: new Set(loadable.hiddenTestcaseIds),
            })
        }

        // Restore locally-added draft rows that were captured in the snapshot
        if (loadable.draftRows && loadable.draftRows.length > 0) {
            set(loadableController.actions.importRows, loadableId, loadable.draftRows)
        }
    },
)

/**
 * Restore local testcase data from a URL snapshot.
 *
 * This is a synchronous compound action that:
 * 1. Gets the loadable ID from the primary node
 * 2. Imports the local testcase rows via loadable controller
 * 3. Sets the connected testset atom to local mode with the snapshot's name
 */
const restoreLocalTestsetAtom = atom(null, (get, set, localTestset: SnapshotLocalTestset) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return

    // Clear existing rows first to make this operation idempotent.
    // Without this, re-hydration (e.g. after HMR) would append duplicate
    // rows because local testcase rows have no stable IDs for dedup.
    set(loadableController.actions.clearRows, loadableId)

    // Import rows via loadable controller (stays in local mode)
    set(loadableController.actions.importRows, loadableId, localTestset.rows)

    // Set connected testset to local mode with the name from the snapshot
    set(connectedTestsetAtom, {
        id: null,
        name: localTestset.name,
    })
})

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
    const bridge = getRunnableBridge()
    bridge.invalidateAllCaches()
})

// ============================================================================
// CRUD ACTIONS (delegate to typed entity-level atoms)
// ============================================================================

const controllerCreateVariantAtom = atom(
    null,
    async (get, set, payload: AppRevisionCreateVariantPayload): Promise<AppRevisionCrudResult> => {
        const selectedIds = get(entityIdsAtom)
        const nodes = get(playgroundNodesAtom)

        const baseRevisionId =
            asNonEmptyString(payload.baseRevisionId) ??
            (payload.baseVariantName
                ? nodes.find((node) => node.label === payload.baseVariantName)?.entityId
                : undefined) ??
            selectedIds[0]

        if (!baseRevisionId) {
            return {
                success: false,
                error: "Could not resolve a base revision for variant creation",
            }
        }

        const projectId = get(projectIdAtom)
        if (!projectId) {
            return {
                success: false,
                error: "No project ID available",
            }
        }

        const baseRevision = await fetchOssRevisionById(baseRevisionId, projectId)
        const appId = asNonEmptyString(baseRevision?.appId)
        if (!appId) {
            return {
                success: false,
                error: "Could not resolve app ID for base revision",
            }
        }

        const result = await set(createLegacyVariantAtom, {
            baseRevisionId,
            newVariantName: payload.newVariantName,
            commitMessage: payload.note,
            appId,
        })

        if (!result.success) {
            return {
                success: false,
                error: result.error.message,
            }
        }

        if (payload.callback) {
            const state = {selected: [...selectedIds]}
            payload.callback({id: result.newRevisionId}, state)
            set(setEntityIdsAtom, state.selected)
        }

        return {
            success: true,
            newRevisionId: result.newRevisionId,
        }
    },
)

const controllerCommitRevisionAtom = atom(
    null,
    async (get, set, payload: AppRevisionCommitPayload): Promise<AppRevisionCrudResult> => {
        // Check if this entity is a workflow type
        const nodes = get(playgroundNodesAtom)
        const node = nodes.find((n) => n.entityId === payload.revisionId)

        if (node?.entityType === "workflow") {
            const result = await set(commitWorkflowRevisionAtom, {
                revisionId: payload.revisionId,
                commitMessage: payload.commitMessage ?? payload.note,
            })
            return {
                success: result.success,
                newRevisionId: result.success ? result.newRevisionId : undefined,
                error: result.success ? undefined : result.error.message,
            }
        }

        // Legacy path (unchanged)
        const bridge = getRunnableBridge()
        const runnableData = get(bridge.selectors.data(payload.revisionId)) as
            | ({configuration?: Record<string, unknown>; variantId?: string} & Record<
                  string,
                  unknown
              >)
            | null

        // Resolve variantId: payload → bridge data → direct API fetch
        let variantId =
            asNonEmptyString(payload.variantId) ?? asNonEmptyString(runnableData?.variantId)
        if (!variantId) {
            const projectId = get(projectIdAtom)
            if (projectId) {
                const fetched = await fetchOssRevisionById(payload.revisionId, projectId)
                variantId = asNonEmptyString(fetched?.variantId)
            }
        }

        if (!variantId) {
            return {
                success: false,
                error: "Could not resolve variant ID for commit",
            }
        }

        const result = await set(commitLegacyRevisionAtom, {
            revisionId: payload.revisionId,
            commitMessage: payload.commitMessage ?? payload.note,
            parameters: payload.parameters ?? runnableData?.configuration ?? {},
            variantId,
        })

        if (!result.success) {
            return {
                success: false,
                error: result.error.message,
            }
        }

        return {
            success: true,
            newRevisionId: result.newRevisionId,
        }
    },
)

const controllerDeleteRevisionAtom = atom(
    null,
    async (get, set, revisionId: string): Promise<AppRevisionCrudResult> => {
        // Check if this entity is a workflow type
        const nodes = get(playgroundNodesAtom)
        const node = nodes.find((n) => n.entityId === revisionId)
        const bridge = getRunnableBridge()

        if (node?.entityType === "workflow") {
            // Read entity data via bridge to extract parent workflow ID
            const store = getDefaultStore()
            const runnableData = store.get(bridge.data(revisionId)) as
                | ({workflow_id?: unknown; id?: unknown} & Record<string, unknown>)
                | null
            const workflowId =
                asNonEmptyString(runnableData?.workflow_id) ??
                asNonEmptyString(runnableData?.id) ??
                revisionId
            const result = await set(archiveWorkflowRevisionAtom, {
                revisionId,
                workflowId,
            })
            return {
                success: result.success,
                error: result.success ? undefined : result.error.message,
            }
        }

        // Legacy path (unchanged)
        const result = await set(deleteLegacyRevisionAtom, {revisionId})
        if (!result.success) {
            return {
                success: false,
                error: result.error.message,
            }
        }
        return {success: true}
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
    const currentRootNodes = currentNodes.filter((node) => node.depth === 0)
    const downstreamNodes = currentNodes.filter((node) => node.depth > 0)
    const currentIds = currentRootNodes.map((node) => node.entityId)
    const rawValue = typeof next === "function" ? next(currentIds) : next
    const seen = new Set<string>()
    const newIds = rawValue.filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
    })
    const existingByEntityId = new Map(currentRootNodes.map((node) => [node.entityId, node]))
    const resolver = getRunnableTypeResolver()
    const newRootNodes: PlaygroundNode[] = newIds.map((entityId) => {
        const existing = existingByEntityId.get(entityId)
        if (existing) return existing
        const entityType = resolver?.getType(entityId) ?? "legacyAppRevision"
        // Register type hint so runnableBridge skips probing other molecule types
        registerRunnableTypeHint(entityId, entityType)
        return {
            id: `node-${entityId}`,
            entityType,
            entityId,
            label: entityId,
            depth: 0,
        }
    })
    // Clear hints for removed entities
    for (const node of currentRootNodes) {
        if (!newIds.includes(node.entityId)) {
            clearRunnableTypeHint(node.entityId)
        }
    }
    // Preserve downstream nodes (e.g. evaluators at depth > 0) when updating root selection.
    // If root selection is cleared entirely, downstream nodes are also removed.
    set(playgroundNodesAtom, newRootNodes.length > 0 ? [...newRootNodes, ...downstreamNodes] : [])

    // Remap connections: if root nodes were removed, any downstream connections
    // that referenced them should be remapped to the new primary root.
    // This prevents evaluators from becoming disconnected when switching from
    // comparison mode back to single mode.
    if (newRootNodes.length > 0 && downstreamNodes.length > 0) {
        const newRootNodeIds = new Set(newRootNodes.map((n) => n.id))
        const newPrimaryNodeId = newRootNodes[0].id
        const connections = get(outputConnectionsAtom)
        const hasStaleSource = connections.some(
            (c) =>
                !newRootNodeIds.has(c.sourceNodeId) &&
                currentRootNodes.some((n) => n.id === c.sourceNodeId),
        )
        if (hasStaleSource) {
            set(
                outputConnectionsAtom,
                connections.map((c) =>
                    !newRootNodeIds.has(c.sourceNodeId) &&
                    currentRootNodes.some((n) => n.id === c.sourceNodeId)
                        ? {...c, sourceNodeId: newPrimaryNodeId}
                        : c,
                ),
            )
        }
    }

    // Ensure primary runnable is linked so loadable-derived columns/rows
    // (including initial variable row) are initialized for the current selection.
    const primary = newRootNodes[0]
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

        /** Number of hidden (removed) testcase IDs in the current loadable */
        hiddenTestcaseCount: () => hiddenTestcaseCountAtom,

        /** Number of locally-added (new) testcase rows */
        newTestcaseCount: () => newTestcaseCountAtom,

        /** Hash of locally-added (new) testcase data (triggers URL re-encode on content edits) */
        newTestcaseDataHash: () => newTestcaseDataHashAtom,

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

        /** Disconnect a single downstream node by its node ID */
        disconnectSingleDownstreamNode: disconnectSingleDownstreamNodeAtom,

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

        /** Restore a testset connection from a URL snapshot (call after primary node is set) */
        restoreLoadableConnection: restoreLoadableConnectionAtom,

        /** Restore local testcase data from a URL snapshot (call after primary node is set) */
        restoreLocalTestset: restoreLocalTestsetAtom,
    },

    /**
     * Dispatch for standard actions
     * Usage: const dispatch = useSetAtom(playgroundController.dispatch)
     */
    dispatch: playgroundDispatchAtom,
}
