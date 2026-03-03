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

import {createBaseRunnable, baseRunnableMolecule} from "@agenta/entities/baseRunnable"
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
import type {TraceSpanNode} from "@agenta/entities/trace"
import {extractAgData, extractInputs, extractOutputs} from "@agenta/entities/trace"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    commitWorkflowRevisionAtom,
    archiveWorkflowRevisionAtom,
    createWorkflowVariantAtom,
} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import type {SnapshotLoadableConnection, SnapshotLocalTestset} from "../../snapshot"
import {outputConnectionsAtom} from "../atoms/connections"
import {
    connectedTestsetAtom,
    editingConnectionIdAtom,
    entityIdsAtom,
    extraColumnsAtom,
    hasMultipleNodesAtom,
    mappingModalOpenAtom,
    playgroundDispatchAtom,
    playgroundNodesAtom,
    selectedNodeIdAtom,
    testsetModalOpenAtom,
} from "../atoms/playground"
import {duplicateSessionResponsesWithContextAtom} from "../chat"
import type {
    AppRevisionCommitPayload,
    AppRevisionCreateVariantPayload,
    AppRevisionCrudResult,
} from "../context"
import {
    displayedEntityIdsAtom,
    isComparisonViewAtom,
    playgroundLayoutAtom,
    playgroundRevisionsReadyAtom,
    playgroundStatusAtom,
    resolvedEntityIdsAtom,
    schemaInputKeysAtom,
} from "../execution/displayedEntities"
import {
    derivedLoadableIdAtom,
    hiddenTestcaseCountAtom,
    inputVariableNamesAtom,
    isChatModeAtom,
    newTestcaseCountAtom,
    newTestcaseDataHashAtom,
} from "../execution/selectors"
import {extractAndLoadChatMessagesAtom} from "../helpers/extractAndLoadChatMessages"
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
                parallel: true,
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

    // Extract chat messages from testcase rows if in chat mode.
    // The entity layer stores `messages` as a regular data column, but the
    // playground chat UI reads from messageIdsAtomFamily/messagesByIdAtomFamily.
    // Without this step, inputPorts load correctly but chat messages are lost.
    const isChat = get(isChatModeAtom) ?? false
    if (isChat) {
        set(extractAndLoadChatMessagesAtom, {
            loadableId,
            testcaseRows: testcasesWithIds as Record<string, unknown>[],
        })
    }
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

    // Extract chat messages from imported testcase rows if in chat mode.
    // Same reasoning as connectToTestsetAtom — the entity layer stores `messages`
    // as data but the chat UI needs them in the message atom system.
    const isChat = get(isChatModeAtom) ?? false
    if (isChat) {
        set(extractAndLoadChatMessagesAtom, {
            loadableId,
            testcaseRows: testcases,
        })
    }
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

    // Extract chat messages from restored testcase rows if in chat mode.
    // The entity layer stores `messages` as a regular data column, but the
    // playground chat UI reads from messageIdsAtomFamily/messagesByIdAtomFamily.
    // Without this step, chat messages are lost after snapshot hydration
    // (e.g. when opening a chat trace span in the playground via URL).
    const isChat = get(isChatModeAtom) ?? false
    if (isChat) {
        // For trace replays (baseRunnable entities), skip appending a blank
        // user message — the loaded messages are the complete conversation.
        const isTraceReplay = loadableId.includes(":baseRunnable:")
        set(extractAndLoadChatMessagesAtom, {
            loadableId,
            testcaseRows: localTestset.rows as Record<string, unknown>[],
            skipBlankMessage: isTraceReplay,
        })
    }
})

// ============================================================================
// OPEN FROM TRACE
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const TRACE_OMIT_KEYS = new Set(["system_prompt", "user_prompt", "input_keys"])

/** Strip omitted keys from each direct child object in parameters */
function stripOmittedKeys(params: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
        if (isRecord(value)) {
            const cleaned: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(value)) {
                if (!TRACE_OMIT_KEYS.has(k)) cleaned[k] = v
            }
            result[key] = cleaned
        } else {
            result[key] = value
        }
    }
    return result
}

/** Check if inputs look like a chat variant (has messages array with role/content objects) */
function looksLikeChat(inputs: Record<string, unknown>): boolean {
    if (!("messages" in inputs) || !Array.isArray(inputs.messages)) return false
    return inputs.messages.some(
        (m) =>
            m &&
            typeof m === "object" &&
            ("role" in (m as Record<string, unknown>) ||
                "content" in (m as Record<string, unknown>)),
    )
}

/**
 * Split chat messages into config (before first user message) and generation (from first user message).
 * Config messages (typically system prompts) go into baseRunnable parameters.
 * Generation messages (user turns onward) go into testcase/loadable data.
 */
function splitChatMessages(messages: {role: string; content: unknown}[]): {
    configMessages: {role: string; content: unknown}[]
    generationMessages: {role: string; content: unknown}[]
} {
    const firstUserIdx = messages.findIndex((m) => m.role === "user")
    if (firstUserIdx <= 0) {
        // No user message or user message is first — nothing to split into config
        return {configMessages: [], generationMessages: messages}
    }
    return {
        configMessages: messages.slice(0, firstUserIdx),
        generationMessages: messages.slice(firstUserIdx),
    }
}

/**
 * Extract model/LLM config from a chat span.
 *
 * Priority:
 * 1. ag.data.parameters (playground-generated traces have model here)
 * 2. attributes.llm.invocation_parameters (observability SDK traces)
 */
function extractModelConfig(span: TraceSpanNode): Record<string, unknown> | null {
    const agData = extractAgData(span)

    // 1. Check ag.data.parameters for direct model or llm_config
    if (isRecord(agData?.parameters)) {
        const params = agData.parameters as Record<string, unknown>
        if (params.model || isRecord(params.llm_config)) {
            return params
        }
    }

    // 2. Fall back to attributes.llm.invocation_parameters
    const attrs = span.attributes as Record<string, unknown> | undefined
    if (attrs) {
        const llm = attrs.llm as Record<string, unknown> | undefined
        if (llm?.invocation_parameters) {
            const raw = llm.invocation_parameters
            if (typeof raw === "string") {
                try {
                    const parsed = JSON.parse(raw)
                    if (isRecord(parsed)) return parsed
                } catch {
                    /* not valid JSON */
                }
            } else if (isRecord(raw)) {
                return raw
            }
        }
    }

    return null
}

/**
 * Reference structure from backend (SimpleTraceReferences):
 * - application: {id, slug, version}
 * - application_variant: {id, slug, version}
 * - application_revision: {id, slug, version}
 * - evaluator: {id, slug, version}
 * - evaluator_variant: {id, slug, version}
 * - evaluator_revision: {id, slug, version}
 */
interface TraceReference {
    id?: string
    slug?: string
    version?: string
}

interface TraceReferences {
    application?: TraceReference
    application_variant?: TraceReference
    application_revision?: TraceReference
    evaluator?: TraceReference
    evaluator_variant?: TraceReference
    evaluator_revision?: TraceReference
}

/**
 * Extract references from ag.references (dict format) or top-level references array
 */
function extractReferences(span: TraceSpanNode): TraceReferences {
    const result: TraceReferences = {}

    // Try ag.references first (dict format from backend)
    const agData = (span.attributes as Record<string, unknown>)?.ag as Record<string, unknown>
    const agRefs = agData?.references as Record<string, TraceReference> | undefined
    if (agRefs) {
        if (agRefs.application) result.application = agRefs.application
        if (agRefs.application_variant) result.application_variant = agRefs.application_variant
        if (agRefs.application_revision) result.application_revision = agRefs.application_revision
        if (agRefs.evaluator) result.evaluator = agRefs.evaluator
        if (agRefs.evaluator_variant) result.evaluator_variant = agRefs.evaluator_variant
        if (agRefs.evaluator_revision) result.evaluator_revision = agRefs.evaluator_revision
    }

    // Also check top-level references array (alternative format)
    const topRefs = span.references as
        | {id?: string; slug?: string; version?: string; attributes?: {key?: string}}[]
        | undefined
    if (topRefs && Array.isArray(topRefs)) {
        for (const ref of topRefs) {
            const key = ref.attributes?.key
            if (!key) continue
            const refData: TraceReference = {id: ref.id, slug: ref.slug, version: ref.version}
            if (key === "application" && !result.application) result.application = refData
            if (key === "application_variant" && !result.application_variant)
                result.application_variant = refData
            if (key === "application_revision" && !result.application_revision)
                result.application_revision = refData
            if (key === "evaluator" && !result.evaluator) result.evaluator = refData
            if (key === "evaluator_variant" && !result.evaluator_variant)
                result.evaluator_variant = refData
            if (key === "evaluator_revision" && !result.evaluator_revision)
                result.evaluator_revision = refData
        }
    }

    return result
}

/**
 * Result from opening a trace in playground.
 * - If `type` is "revision", the trace has a valid application_revision reference
 *   and the playground opened that existing revision.
 * - If `type` is "baseRunnable", a new baseRunnable was created from the trace data.
 */
export interface OpenFromTraceResult {
    type: "revision" | "baseRunnable"
    entityId: string
    label: string
    inputs: Record<string, unknown>
    /** For workflow spans with app references — used for navigation to app playground */
    appId?: string
}

/**
 * Open a trace span in the playground.
 *
 * Flow:
 * 1. Extracts inputs, outputs, and parameters from the span's ag.data
 * 2. Checks for application_revision reference - if present, opens that revision directly
 * 3. Otherwise, creates a local baseRunnable entity from trace data
 * 4. Adds it as the primary playground node
 * 5. Populates the loadable with trace inputs as a testset row
 * 6. For chat spans, extracts messages into chat message atoms
 *
 * Navigation to the playground page is handled by the calling component.
 */
const openFromTraceAtom = atom(
    null,
    (_get, set, activeSpan: TraceSpanNode): OpenFromTraceResult => {
        const spanType = activeSpan.span_type
        const agData = extractAgData(activeSpan)
        const refs = extractReferences(activeSpan)

        // Determine label from references
        const label =
            refs.application_variant?.slug ||
            refs.application?.slug ||
            refs.evaluator_variant?.slug ||
            refs.evaluator?.slug ||
            agData?.variantName ||
            activeSpan.span_name ||
            "Trace Replay"

        // ── WORKFLOW SPANS ──────────────────────────────────────────────
        // Workflow spans with an app reference open in the app playground.
        if (spanType === "workflow") {
            const appId = refs.application?.id

            // Extract data (same as legacy path)
            let rawInputs = extractInputs(activeSpan)
            if (Object.keys(rawInputs).length === 0 && typeof agData?.inputs === "string") {
                try {
                    const parsed = JSON.parse(agData.inputs)
                    if (isRecord(parsed)) rawInputs = parsed
                } catch {
                    /* not valid JSON */
                }
            }

            let outputs = extractOutputs(activeSpan)
            if (typeof outputs === "string") {
                try {
                    outputs = JSON.parse(outputs)
                } catch {
                    /* keep as string */
                }
            }

            const hasNestedInputs = isRecord(rawInputs.inputs)
            const templateInputs = hasNestedInputs
                ? (rawInputs.inputs as Record<string, unknown>)
                : rawInputs
            const chatMessages =
                hasNestedInputs && Array.isArray(rawInputs.messages) ? rawInputs.messages : null
            const actualInputs: Record<string, unknown> = {
                ...templateInputs,
                ...(chatMessages ? {messages: chatMessages} : {}),
            }

            let rawAgParameters = agData?.parameters
            if (typeof rawAgParameters === "string") {
                try {
                    const parsed = JSON.parse(rawAgParameters)
                    if (isRecord(parsed)) rawAgParameters = parsed
                } catch {
                    rawAgParameters = undefined
                }
            }
            const rawParameters = (
                hasNestedInputs && isRecord(rawInputs.parameters)
                    ? rawInputs.parameters
                    : isRecord(rawAgParameters)
                      ? rawAgParameters
                      : {}
            ) as Record<string, unknown>
            const parameters = stripOmittedKeys(rawParameters)

            // If there's an app_revision reference, open that revision directly
            const revisionId = refs.application_revision?.id || refs.application_revision?.version
            if (revisionId) {
                set(addPrimaryNodeAtom, {
                    type: "legacyAppRevision",
                    id: revisionId,
                    label,
                })

                if (Object.keys(actualInputs).length > 0) {
                    const loadableId = `testset:legacyAppRevision:${revisionId}`
                    set(loadableController.actions.setRows, loadableId, [
                        {id: "trace-input-0", data: actualInputs},
                    ])
                    if (looksLikeChat(actualInputs)) {
                        set(extractAndLoadChatMessagesAtom, {
                            loadableId,
                            testcaseRows: [actualInputs],
                            skipBlankMessage: true,
                        })
                    }
                }

                return {
                    type: "revision",
                    entityId: revisionId,
                    label,
                    inputs: actualInputs,
                    appId,
                }
            }

            // No revision — create baseRunnable
            const {id: entityId, data} = createBaseRunnable({
                label,
                inputs: actualInputs,
                outputs,
                parameters,
                sourceRef: appId
                    ? {type: "application", id: appId, slug: refs.application?.slug}
                    : undefined,
            })
            baseRunnableMolecule.set.data(entityId, data)
            set(addPrimaryNodeAtom, {type: "baseRunnable", id: entityId, label})

            if (Object.keys(actualInputs).length > 0) {
                const loadableId = `testset:baseRunnable:${entityId}`
                set(loadableController.actions.setRows, loadableId, [
                    {id: "trace-input-0", data: actualInputs},
                ])
                if (looksLikeChat(actualInputs)) {
                    set(extractAndLoadChatMessagesAtom, {
                        loadableId,
                        testcaseRows: [actualInputs],
                        skipBlankMessage: true,
                    })
                }
            }

            return {
                type: "baseRunnable",
                entityId,
                label,
                inputs: actualInputs,
                appId,
            }
        }

        // ── CHAT SPANS ─────────────────────────────────────────────────
        // Chat spans always create a baseRunnable in the project playground.
        // Extract config messages (before first user) vs generation messages.

        // Get raw prompt messages from inputs.prompt
        let rawInputs = extractInputs(activeSpan)
        if (Object.keys(rawInputs).length === 0 && typeof agData?.inputs === "string") {
            try {
                const parsed = JSON.parse(agData.inputs)
                if (isRecord(parsed)) rawInputs = parsed
            } catch {
                /* not valid JSON */
            }
        }

        let outputs = extractOutputs(activeSpan)
        if (typeof outputs === "string") {
            try {
                outputs = JSON.parse(outputs)
            } catch {
                /* keep as string */
            }
        }

        // Chat spans have inputs.prompt as an array of {role, content} messages
        const promptMessages = rawInputs.prompt
        const isChatFormat = Array.isArray(promptMessages) && promptMessages.length > 0

        if (isChatFormat) {
            // Split messages: config (before first user) vs generation (from first user)
            const {configMessages, generationMessages} = splitChatMessages(
                promptMessages as {role: string; content: unknown}[],
            )

            // Build model/llm config from span data
            const modelConfig = extractModelConfig(activeSpan)
            const llmConfig: Record<string, unknown> = {}
            if (modelConfig) {
                if (modelConfig.model) {
                    llmConfig.model = modelConfig.model
                } else if (isRecord(modelConfig.llm_config)) {
                    Object.assign(llmConfig, modelConfig.llm_config)
                }
            }

            // Build parameters with config messages and model config
            const parameters: Record<string, unknown> = {
                prompt: {
                    messages: configMessages,
                    ...(Object.keys(llmConfig).length > 0 ? {llm_config: llmConfig} : {}),
                },
            }

            // Generation messages go into testcase as chat messages
            const actualInputs: Record<string, unknown> = {
                messages: generationMessages,
            }

            const {id: entityId, data} = createBaseRunnable({
                label,
                inputs: actualInputs,
                outputs,
                parameters,
                sourceRef: refs.application?.id
                    ? {
                          type: "application",
                          id: refs.application.id,
                          slug: refs.application.slug,
                      }
                    : undefined,
            })
            baseRunnableMolecule.set.data(entityId, data)
            set(addPrimaryNodeAtom, {type: "baseRunnable", id: entityId, label})

            const loadableId = `testset:baseRunnable:${entityId}`
            set(loadableController.actions.setRows, loadableId, [
                {id: "trace-input-0", data: actualInputs},
            ])
            set(extractAndLoadChatMessagesAtom, {
                loadableId,
                testcaseRows: [actualInputs],
                skipBlankMessage: true,
            })

            return {
                type: "baseRunnable",
                entityId,
                label,
                inputs: actualInputs,
            }
        }

        // Fallback for chat spans without standard prompt format —
        // use the legacy extraction logic
        const hasNestedInputs = isRecord(rawInputs.inputs)
        const templateInputs = hasNestedInputs
            ? (rawInputs.inputs as Record<string, unknown>)
            : rawInputs
        const chatMessages =
            hasNestedInputs && Array.isArray(rawInputs.messages) ? rawInputs.messages : null
        const actualInputs: Record<string, unknown> = {
            ...templateInputs,
            ...(chatMessages ? {messages: chatMessages} : {}),
        }

        let rawAgParameters = agData?.parameters
        if (typeof rawAgParameters === "string") {
            try {
                const parsed = JSON.parse(rawAgParameters)
                if (isRecord(parsed)) rawAgParameters = parsed
            } catch {
                rawAgParameters = undefined
            }
        }
        const rawParameters = (
            hasNestedInputs && isRecord(rawInputs.parameters)
                ? rawInputs.parameters
                : isRecord(rawAgParameters)
                  ? rawAgParameters
                  : {}
        ) as Record<string, unknown>
        const parameters = stripOmittedKeys(rawParameters)

        const {id: entityId, data} = createBaseRunnable({
            label,
            inputs: actualInputs,
            outputs,
            parameters,
            sourceRef: refs.application?.id
                ? {
                      type: "application",
                      id: refs.application.id,
                      slug: refs.application.slug,
                  }
                : refs.evaluator?.id
                  ? {
                        type: "evaluator",
                        id: refs.evaluator.id,
                        slug: refs.evaluator.slug,
                    }
                  : undefined,
        })
        baseRunnableMolecule.set.data(entityId, data)
        set(addPrimaryNodeAtom, {type: "baseRunnable", id: entityId, label})

        if (Object.keys(actualInputs).length > 0) {
            const loadableId = `testset:baseRunnable:${entityId}`
            set(loadableController.actions.setRows, loadableId, [
                {id: "trace-input-0", data: actualInputs},
            ])
            if (looksLikeChat(actualInputs)) {
                set(extractAndLoadChatMessagesAtom, {
                    loadableId,
                    testcaseRows: [actualInputs],
                    skipBlankMessage: true,
                })
            }
        }

        return {
            type: "baseRunnable",
            entityId,
            label,
            inputs: actualInputs,
        }
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
    const _t0 = performance.now()
    const {queryClient} = await import("@agenta/shared/api")

    const queryKeys = [
        ["variants"],
        ["variantRevisions"],
        ["appVariants"],
        ["appVariantRevisions"],
        ["oss-variants-for-selection"],
        ["oss-revisions-for-selection"],
        ["workflows"],
    ]

    // Invalidate to mark as stale
    await Promise.all(
        queryKeys.map((queryKey) => queryClient.invalidateQueries({queryKey, exact: false})),
    )
    console.log(
        `[invalidateQueries] invalidate (mark stale): ${(performance.now() - _t0).toFixed(0)}ms`,
    )

    // Refetch with type: 'all' to bypass cache
    const _t1 = performance.now()
    await Promise.all(
        queryKeys.map((queryKey) =>
            queryClient
                .refetchQueries({queryKey, type: "all", exact: false})
                .then(() =>
                    console.log(
                        `[invalidateQueries] refetch [${queryKey[0]}]: ${(performance.now() - _t1).toFixed(0)}ms`,
                    ),
                ),
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

        // Check if this entity is a workflow type
        const node = nodes.find((n) => n.entityId === baseRevisionId)

        if (node?.entityType === "workflow") {
            const result = await set(createWorkflowVariantAtom, {
                baseRevisionId,
                newVariantName: payload.newVariantName,
                commitMessage: payload.note,
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
        }

        // Legacy path (unchanged)
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

        if (node?.entityType === "workflow") {
            // Read raw workflow entity data (NOT bridge.data which transforms to RunnableData
            // and strips workflow_id). The archive API expects the artifact-level workflow ID.
            const entityData = workflowMolecule.get.data(revisionId) as
                | ({workflow_id?: unknown; workflow_variant_id?: unknown; id?: unknown} & Record<
                      string,
                      unknown
                  >)
                | null
            const workflowId = asNonEmptyString(entityData?.workflow_id)
            if (!workflowId) {
                return {
                    success: false,
                    error: `Cannot delete workflow: missing workflow_id for revision ${revisionId}`,
                }
            }
            const variantId = asNonEmptyString(entityData?.workflow_variant_id)
            const result = await set(archiveWorkflowRevisionAtom, {
                revisionId,
                workflowId,
                variantId: variantId ?? undefined,
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

        /** Open a trace span in the playground (extract data, create entity, populate testcase) */
        openFromTrace: openFromTraceAtom,
    },

    /**
     * Dispatch for standard actions
     * Usage: const dispatch = useSetAtom(playgroundController.dispatch)
     */
    dispatch: playgroundDispatchAtom,
}
