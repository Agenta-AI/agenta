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
 * addPrimary({ type: 'workflow', id: 'rev-123', label: 'My Revision' })
 * ```
 */

import {loadableStateAtomFamily} from "@agenta/entities/loadable"
import {loadableController, snapshotAdapterRegistry} from "@agenta/entities/runnable"
import {fetchTestcasesPage} from "@agenta/entities/testcase"
import type {TraceSpanNode} from "@agenta/entities/trace"
import {extractAgData, extractInputs, extractOutputs} from "@agenta/entities/trace"
import {workflowMolecule, createEphemeralWorkflow} from "@agenta/entities/workflow"
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
import {normalizeTestcaseRowsForLoad} from "../helpers/testcaseRowNormalization"
import type {EntitySelection, PlaygroundNode, RunnableType} from "../types"

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

        // Clear stale execution results before linking.
        // The loadable ID is entity-scoped, so a previous session with the same
        // entity (e.g. same app selected for a different evaluator) would leave
        // results in the atom family that shouldn't appear in a fresh playground.
        const prevState = get(loadableStateAtomFamily(loadableId))
        if (Object.keys(prevState.executionResults).length > 0) {
            set(loadableStateAtomFamily(loadableId), {
                ...prevState,
                executionResults: {},
            })
        }

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
        // so the per-ID fetch fires immediately.
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

    // Clear stale execution results before linking to the new runnable.
    // This prevents results from a previous session (e.g. a different evaluator
    // that tested the same app) from leaking into the current playground.
    const loadableId = `testset:${entity.type}:${entity.id}`
    const prevState = get(loadableStateAtomFamily(loadableId))
    if (Object.keys(prevState.executionResults).length > 0) {
        set(loadableStateAtomFamily(loadableId), {
            ...prevState,
            executionResults: {},
        })
    }

    // Link the loadable to the new runnable via controller API
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
 * 1. Snapshots current rows when `preserveRows` is true (must happen before disconnect)
 * 2. Calls loadable disconnect (clears connectedSourceId, testcase IDs)
 * 3. Regenerates a local testset name from the primary node's label
 * 4. Re-populates with snapshotted rows or creates an initial empty row
 *
 * When `preserveRows` is false (default), the playground returns to the same
 * state as initial setup. When true (e.g. after "Save & disconnect"), the
 * committed data stays visible as local rows.
 */
const disconnectAndResetToLocalAtom = atom(
    null,
    (get, set, loadableId: string, options?: {preserveRows?: boolean}) => {
        const rootNode = get(playgroundNodesAtom).find((n) => n.depth === 0)
        if (!rootNode) return

        // 1. Snapshot current rows before disconnect wipes testcase IDs
        const rowsSnapshot = options?.preserveRows
            ? get(loadableController.selectors.rows(loadableId))
            : null

        // 2. Call loadable disconnect action
        set(loadableController.actions.disconnect, loadableId)

        // 3. Generate and set local testset name
        const localTestsetName = generateLocalTestsetName(rootNode.label)
        set(connectedTestsetAtom, {
            id: null, // null id indicates it's a local (unsaved) testset
            name: localTestsetName,
        })

        // 4. Re-populate with snapshotted rows or create an initial empty row
        if (rowsSnapshot && rowsSnapshot.length > 0) {
            for (const row of rowsSnapshot) {
                set(loadableController.actions.addRow, loadableId, row.data ?? {})
            }
        } else {
            set(loadableController.actions.addRow, loadableId, {})
        }
    },
)

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

    // Generate a fallback display name from the available selection info
    const displayName = testsetName
        ? revisionVersion != null
            ? `${testsetName} (v${revisionVersion})`
            : testsetName
        : undefined

    const normalizedRows = normalizeTestcaseRowsForLoad(testcases)

    // Ensure testcases have IDs and store them in nested testcase formatat
    const testcasesWithIds = normalizedRows.map((row, index) => {
        const id = row.id ?? `testcase-${Date.now()}-${index}`
        return {id, data: row.data}
    })
    const flatRows = testcasesWithIds.map(({id, data}) => ({id, ...data}))

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
            testcaseRows: flatRows,
            skipBlankMessage: true,
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
    const normalizedRows = normalizeTestcaseRowsForLoad(testcases)
    const flatRows = normalizedRows.map(({id, data}) => (id ? {id, ...data} : {...data}))

    // Import rows via loadable controller (stays in local mode)
    set(loadableController.actions.importRows, loadableId, flatRows)

    // Extract chat messages from imported testcase rows if in chat mode.
    // Same reasoning as connectToTestsetAtom — the entity layer stores `messages`
    // as data but the chat UI needs them in the message atom system.
    const isChat = get(isChatModeAtom) ?? false
    if (isChat) {
        set(extractAndLoadChatMessagesAtom, {
            loadableId,
            testcaseRows: flatRows,
            skipBlankMessage: true,
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
        // For trace replays (ephemeral local workflow entities), skip appending a blank
        // user message — the loaded messages are the complete conversation.
        const isTraceReplay = loadableId.includes(":workflow:local-")
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

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined
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

/**
 * Detect PromptTemplate-shaped values inside ag.data.inputs.
 *
 * `@ag.instrument()` captures every function argument as an input, so a
 * sub-task like `summarize(prompt: PromptTemplate, blog_post: str)` ends
 * up with the prompt config living under `inputs.prompt`. Those values
 * belong in the variant configuration panel, not as testcase fields —
 * this helper lets us promote them back into parameters.
 *
 * Shape check is structural: a PromptTemplate has a `messages` array or
 * an `llm_config` object. Matching `template_format` is an extra signal
 * to avoid false positives on user dicts that happen to carry messages.
 */
function looksLikePromptConfig(value: unknown): boolean {
    if (!isRecord(value)) return false
    const hasMessages = Array.isArray(value.messages) && value.messages.length > 0
    const hasLlmConfig = isRecord(value.llm_config)
    const hasTemplateFormat = typeof value.template_format === "string"
    return (hasMessages || hasLlmConfig) && (hasTemplateFormat || hasLlmConfig)
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
 * Config messages (typically system prompts) go into ephemeral workflow parameters.
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
 * - If `type` is "ephemeral", a new ephemeral workflow was created from the trace data.
 */
export interface OpenFromTraceResult {
    type: "revision" | "ephemeral"
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
 * 3. Otherwise, creates a local ephemeral workflow entity from trace data
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
            asString(refs.application_variant?.slug) ??
            asString(refs.application?.slug) ??
            asString(refs.evaluator_variant?.slug) ??
            asString(refs.evaluator?.slug) ??
            asString(agData.variantName) ??
            asString(activeSpan.span_name) ??
            "Trace Replay"

        // Extract safe reference IDs (origin's asString guards)
        const applicationId = asString(refs.application?.id)
        const applicationSlug = asString(refs.application?.slug)
        const evaluatorId = asString(refs.evaluator?.id)
        const evaluatorSlug = asString(refs.evaluator?.slug)

        // ── WORKFLOW-LIKE SPANS ─────────────────────────────────────────
        // `workflow`, `task`, `agent`, `chain` — all represent an invocation
        // tied to a variant. With an app_revision reference we open that
        // revision in the app playground; otherwise we fall back to an
        // ephemeral workflow seeded from the span's ag.data.
        if (
            spanType === "workflow" ||
            spanType === "task" ||
            spanType === "agent" ||
            spanType === "chain"
        ) {
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
            const baseParameters = stripOmittedKeys(rawParameters)

            // Task/agent/chain spans often capture prompt config as inputs
            // (because `@ag.instrument()` records every function argument).
            // Promote those PromptTemplate-shaped values into parameters so
            // they render in the config panel rather than as testcase fields.
            const promotedConfig: Record<string, unknown> = {}
            const cleanedInputs: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(actualInputs)) {
                if (looksLikePromptConfig(value) && !(key in baseParameters)) {
                    promotedConfig[key] = value
                } else {
                    cleanedInputs[key] = value
                }
            }
            const parameters =
                Object.keys(promotedConfig).length > 0
                    ? {...baseParameters, ...promotedConfig}
                    : baseParameters
            const testcaseInputs =
                Object.keys(promotedConfig).length > 0 ? cleanedInputs : actualInputs

            // If there's an app_revision reference with a resolvable UUID,
            // open that revision directly. A bare `version` (e.g. "1") is
            // a sequence number — not a revision ID — so we can't target a
            // specific revision with it and fall through to the ephemeral
            // path below (which still navigates to the app playground).
            const revisionId = asString(refs.application_revision?.id)
            if (revisionId) {
                set(addPrimaryNodeAtom, {
                    type: "workflow",
                    id: revisionId,
                    label,
                })

                if (Object.keys(testcaseInputs).length > 0) {
                    const loadableId = `testset:workflow:${revisionId}`
                    set(loadableController.actions.setRows, loadableId, [
                        {id: "trace-input-0", data: testcaseInputs},
                    ])
                    if (looksLikeChat(testcaseInputs)) {
                        set(extractAndLoadChatMessagesAtom, {
                            loadableId,
                            testcaseRows: [testcaseInputs],
                            skipBlankMessage: true,
                        })
                    }
                }

                return {
                    type: "revision",
                    entityId: revisionId,
                    label,
                    inputs: testcaseInputs,
                    appId: applicationId,
                }
            }

            // No revision — create ephemeral workflow
            const {id: entityId} = createEphemeralWorkflow({
                label,
                inputs: testcaseInputs,
                outputs,
                parameters,
                sourceRef: applicationId
                    ? {type: "application", id: applicationId, slug: applicationSlug}
                    : undefined,
            })
            set(addPrimaryNodeAtom, {type: "workflow", id: entityId, label})

            if (Object.keys(testcaseInputs).length > 0) {
                const loadableId = `testset:workflow:${entityId}`
                set(loadableController.actions.setRows, loadableId, [
                    {id: "trace-input-0", data: testcaseInputs},
                ])
                if (looksLikeChat(testcaseInputs)) {
                    set(extractAndLoadChatMessagesAtom, {
                        loadableId,
                        testcaseRows: [testcaseInputs],
                        skipBlankMessage: true,
                    })
                }
            }

            return {
                type: "ephemeral",
                entityId,
                label,
                inputs: testcaseInputs,
                appId: applicationId,
            }
        }

        // ── CHAT SPANS ─────────────────────────────────────────────────
        // Chat spans always create an ephemeral workflow in the project playground.
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

            // If the last user message in generationMessages has no response after it,
            // append output completion messages. This handles spans where:
            //   inputs.prompt = [user]
            //   outputs.completion = [assistant+tool_calls, tool]
            // Without this, the assistant response and tool messages are lost.
            // Safe for the working case where prompt already contains the full
            // conversation — there the last user will have responses after it.
            if (isRecord(outputs)) {
                let lastUserIdx = -1
                for (let i = generationMessages.length - 1; i >= 0; i--) {
                    if (generationMessages[i].role === "user") {
                        lastUserIdx = i
                        break
                    }
                }
                const hasResponseToLastUser =
                    lastUserIdx >= 0 &&
                    generationMessages.slice(lastUserIdx + 1).some((m) => m.role !== "user")

                if (lastUserIdx >= 0 && !hasResponseToLastUser) {
                    const completion = (outputs as Record<string, unknown>).completion
                    if (Array.isArray(completion)) {
                        for (const msg of completion) {
                            if (
                                isRecord(msg) &&
                                typeof (msg as Record<string, unknown>).role === "string"
                            ) {
                                generationMessages.push(msg as {role: string; content: unknown})
                            }
                        }
                    }
                }
            }

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

            // Extract tools/functions from span inputs or parameters
            const toolsOrFunctions =
                rawInputs.tools ??
                rawInputs.functions ??
                (isRecord(agData?.parameters)
                    ? ((agData.parameters as Record<string, unknown>).tools ??
                      (agData.parameters as Record<string, unknown>).functions)
                    : undefined)

            // Build parameters with config messages, model config, and tools.
            // Tools must live inside `prompt` for the config UI to render them.
            // When llm_config is present, nest tools inside it; otherwise place
            // them directly in prompt.
            const hasLlmConfig = Object.keys(llmConfig).length > 0
            const hasTools = Array.isArray(toolsOrFunctions) && toolsOrFunctions.length > 0

            const promptValue: Record<string, unknown> = {
                messages: configMessages,
                ...(hasLlmConfig
                    ? {
                          llm_config: {
                              ...llmConfig,
                              ...(hasTools ? {tools: toolsOrFunctions} : {}),
                          },
                      }
                    : hasTools
                      ? {tools: toolsOrFunctions}
                      : {}),
            }

            const parameters: Record<string, unknown> = {
                prompt: promptValue,
            }

            // Generation messages go into testcase as chat messages
            const actualInputs: Record<string, unknown> = {
                messages: generationMessages,
            }

            const {id: entityId} = createEphemeralWorkflow({
                label,
                inputs: actualInputs,
                outputs,
                parameters,
                sourceRef: applicationId
                    ? {
                          type: "application",
                          id: applicationId,
                          slug: applicationSlug,
                      }
                    : undefined,
            })
            set(addPrimaryNodeAtom, {type: "workflow", id: entityId, label})

            const loadableId = `testset:workflow:${entityId}`
            set(loadableController.actions.setRows, loadableId, [
                {id: "trace-input-0", data: actualInputs},
            ])
            set(extractAndLoadChatMessagesAtom, {
                loadableId,
                testcaseRows: [actualInputs],
                skipBlankMessage: true,
            })

            return {
                type: "ephemeral",
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

        const {id: entityId} = createEphemeralWorkflow({
            label,
            inputs: actualInputs,
            outputs,
            parameters,
            sourceRef: applicationId
                ? {
                      type: "application",
                      id: applicationId,
                      slug: applicationSlug,
                  }
                : evaluatorId
                  ? {
                        type: "evaluator",
                        id: evaluatorId,
                        slug: evaluatorSlug,
                    }
                  : undefined,
        })
        set(addPrimaryNodeAtom, {type: "workflow", id: entityId, label})

        if (Object.keys(actualInputs).length > 0) {
            const loadableId = `testset:workflow:${entityId}`
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
            type: "ephemeral",
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
    workflowMolecule.cache.invalidateList()
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
    },
)

const controllerCommitRevisionAtom = atom(
    null,
    async (_get, set, payload: AppRevisionCommitPayload): Promise<AppRevisionCrudResult> => {
        const result = await set(commitWorkflowRevisionAtom, {
            revisionId: payload.revisionId,
            commitMessage: payload.commitMessage ?? payload.note,
        })
        return {
            success: result.success,
            newRevisionId: result.success ? result.newRevisionId : undefined,
            error: result.success ? undefined : result.error.message,
        }
    },
)

const controllerDeleteRevisionAtom = atom(
    null,
    async (_get, set, revisionId: string): Promise<AppRevisionCrudResult> => {
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
        const entityType = resolver?.getType(entityId) ?? "workflow"
        return {
            id: `node-${entityId}`,
            entityType,
            entityId,
            label: entityId,
            depth: 0,
        }
    })
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
