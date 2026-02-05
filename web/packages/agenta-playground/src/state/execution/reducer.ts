/**
 * Execution Module Reducer Actions
 *
 * Write atoms for managing execution state lifecycle:
 * - Session management (init, add, remove, set active)
 * - Step management (add, update, remove)
 * - Run lifecycle (start, complete, fail, cancel)
 *
 * @module execution/reducer
 */

import {
    executeRunnable,
    resolveChainInputs,
    computeTopologicalOrder,
    runnableBridge,
    type RunnableType,
    type RunnableData,
    type ExecutionResult,
    type StageExecutionResult,
    type EntitySelection,
} from "@agenta/entities/runnable"
import {atom, type Setter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {outputConnectionsAtom} from "../atoms"
import {playgroundNodesAtom, primaryNodeAtom} from "../atoms/playground"
import type {OutputConnection, PlaygroundNode} from "../types"

import {
    executionStateAtomFamily,
    executionModeAtomFamily,
    sessionsByIdAtomFamily,
    activeSessionIdsAtomFamily,
    stepsByIdAtomFamily,
    stepIdsAtomFamily,
    resultsByKeyAtomFamily,
    buildResultKey,
    activeSessionsAtomFamily,
} from "./atoms"
import type {
    ExecutionSession,
    ExecutionStep,
    RunResult,
    InitSessionsPayload,
    RunStepPayload,
    AddStepPayload,
    CancelStepPayload,
    ExecutionInput,
} from "./types"

// ============================================================================
// SESSION ACTIONS
// ============================================================================

/**
 * Initialize execution sessions
 *
 * Replaces all existing sessions with the provided sessions.
 * Also sets all sessions as active by default.
 *
 * @example
 * const init = useSetAtom(initSessionsAtom)
 * init({
 *     loadableId: "loadable-1",
 *     sessions: [
 *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
 *     ]
 * })
 */
export const initSessionsAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & InitSessionsPayload) => {
        const {loadableId, sessions} = payload
        const sessionsById: Record<string, ExecutionSession> = {}
        const activeSessionIds: string[] = []

        for (const session of sessions) {
            sessionsById[session.id] = session
            activeSessionIds.push(session.id)
        }

        set(sessionsByIdAtomFamily(loadableId), sessionsById)
        set(activeSessionIdsAtomFamily(loadableId), activeSessionIds)

        // Set mode from first session (all sessions should have same mode)
        if (sessions.length > 0) {
            set(executionModeAtomFamily(loadableId), sessions[0].mode)
        }
    },
)

/**
 * Add a single session
 *
 * @example
 * const addSession = useSetAtom(addSessionAtom)
 * addSession({
 *     loadableId: "loadable-1",
 *     session: { id: "sess:rev2", runnableId: "rev2", runnableType: "appRevision", mode: "completion" }
 * })
 */
export const addSessionAtom = atom(
    null,
    (get, set, payload: {loadableId: string; session: ExecutionSession}) => {
        const {loadableId, session} = payload
        const sessionsById = get(sessionsByIdAtomFamily(loadableId))
        const activeSessionIds = get(activeSessionIdsAtomFamily(loadableId))

        set(sessionsByIdAtomFamily(loadableId), {
            ...sessionsById,
            [session.id]: session,
        })

        // Add to active sessions if not already present
        if (!activeSessionIds.includes(session.id)) {
            set(activeSessionIdsAtomFamily(loadableId), [...activeSessionIds, session.id])
        }
    },
)

/**
 * Remove a session
 *
 * Removes the session and all its results.
 *
 * @example
 * const removeSession = useSetAtom(removeSessionAtom)
 * removeSession({ loadableId: "loadable-1", sessionId: "sess:rev1" })
 */
export const removeSessionAtom = atom(
    null,
    (get, set, payload: {loadableId: string; sessionId: string}) => {
        const {loadableId, sessionId} = payload
        const sessionsById = {...get(sessionsByIdAtomFamily(loadableId))}
        const activeSessionIds = get(activeSessionIdsAtomFamily(loadableId))
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}

        // Remove session
        delete sessionsById[sessionId]
        set(sessionsByIdAtomFamily(loadableId), sessionsById)

        // Remove from active sessions
        set(
            activeSessionIdsAtomFamily(loadableId),
            activeSessionIds.filter((id) => id !== sessionId),
        )

        // Remove all results for this session
        for (const key of Object.keys(resultsByKey)) {
            if (key.endsWith(`:${sessionId}`)) {
                delete resultsByKey[key]
            }
        }
        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Set active sessions (for compare mode)
 *
 * @example
 * const setActive = useSetAtom(setActiveSessionsAtom)
 * setActive({ loadableId: "loadable-1", sessionIds: ["sess:rev1", "sess:rev2"] })
 */
export const setActiveSessionsAtom = atom(
    null,
    (get, set, payload: {loadableId: string; sessionIds: string[]}) => {
        const {loadableId, sessionIds} = payload
        set(activeSessionIdsAtomFamily(loadableId), sessionIds)
    },
)

// ============================================================================
// STEP ACTIONS
// ============================================================================

/**
 * Generate a unique step ID
 */
function generateStepId(): string {
    return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Add a step (primarily for chat mode)
 *
 * @example
 * const addStep = useSetAtom(addStepAtom)
 * addStep({
 *     loadableId: "loadable-1",
 *     input: { kind: "chat", role: "user", content: "Hello!" }
 * })
 */
export const addStepAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & AddStepPayload): string => {
        const {loadableId, input, id} = payload
        const stepsById = get(stepsByIdAtomFamily(loadableId))
        const stepIds = get(stepIdsAtomFamily(loadableId))

        const stepId = id ?? generateStepId()
        const step: ExecutionStep = {
            id: stepId,
            input,
            createdAt: Date.now(),
        }

        set(stepsByIdAtomFamily(loadableId), {...stepsById, [stepId]: step})
        set(stepIdsAtomFamily(loadableId), [...stepIds, stepId])

        return stepId
    },
)

/**
 * Update step input (for editing before execution)
 *
 * @example
 * const updateStep = useSetAtom(updateStepInputAtom)
 * updateStep({
 *     loadableId: "loadable-1",
 *     stepId: "step-123",
 *     input: { kind: "chat", role: "user", content: "Updated content" }
 * })
 */
export const updateStepInputAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string; input: ExecutionInput}) => {
        const {loadableId, stepId, input} = payload
        const stepsById = {...get(stepsByIdAtomFamily(loadableId))}

        if (stepsById[stepId]) {
            stepsById[stepId] = {...stepsById[stepId], input}
            set(stepsByIdAtomFamily(loadableId), stepsById)
        }
    },
)

/**
 * Remove a step and its results
 *
 * @example
 * const removeStep = useSetAtom(removeStepAtom)
 * removeStep({ loadableId: "loadable-1", stepId: "step-123" })
 */
export const removeStepAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string}) => {
        const {loadableId, stepId} = payload
        const stepsById = {...get(stepsByIdAtomFamily(loadableId))}
        const stepIds = get(stepIdsAtomFamily(loadableId))
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}

        // Remove step
        delete stepsById[stepId]
        set(stepsByIdAtomFamily(loadableId), stepsById)

        // Remove from step IDs
        set(
            stepIdsAtomFamily(loadableId),
            stepIds.filter((id) => id !== stepId),
        )

        // Remove all results for this step
        for (const key of Object.keys(resultsByKey)) {
            if (key.startsWith(`${stepId}:`)) {
                delete resultsByKey[key]
            }
        }
        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

// ============================================================================
// RUN LIFECYCLE ACTIONS
// ============================================================================

/**
 * Start a run for a specific step and session
 *
 * Sets the result to "running" status.
 */
export const startRunAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string; sessionId: string; runId: string}) => {
        const {loadableId, stepId, sessionId, runId} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)

        resultsByKey[key] = {
            status: "running",
            sessionId,
            runId,
            startedAt: Date.now(),
        }

        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Complete a run successfully
 */
export const completeRunAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            loadableId: string
            stepId: string
            sessionId: string
            result: Partial<RunResult>
        },
    ) => {
        const {loadableId, stepId, sessionId, result} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)
        const existing = resultsByKey[key] ?? {sessionId, status: "idle" as const}

        resultsByKey[key] = {
            ...existing,
            ...result,
            status: "success",
            completedAt: Date.now(),
        }

        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Fail a run with error
 */
export const failRunAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            loadableId: string
            stepId: string
            sessionId: string
            error: {message: string; code?: string}
        },
    ) => {
        const {loadableId, stepId, sessionId, error} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)
        const existing = resultsByKey[key] ?? {sessionId, status: "idle" as const}

        resultsByKey[key] = {
            ...existing,
            status: "error",
            error,
            completedAt: Date.now(),
        }

        set(resultsByKeyAtomFamily(loadableId), resultsByKey)
    },
)

/**
 * Cancel a run
 */
export const cancelRunAtom = atom(
    null,
    (get, set, payload: {loadableId: string; stepId: string; sessionId: string}) => {
        const {loadableId, stepId, sessionId} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)
        const existing = resultsByKey[key]

        if (existing && (existing.status === "running" || existing.status === "pending")) {
            resultsByKey[key] = {
                ...existing,
                status: "cancelled",
                completedAt: Date.now(),
            }
            set(resultsByKeyAtomFamily(loadableId), resultsByKey)
        }
    },
)

/**
 * Update chain progress during execution
 */
export const updateChainProgressAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            loadableId: string
            stepId: string
            sessionId: string
            chainProgress: RunResult["chainProgress"]
            chainResults?: RunResult["chainResults"]
        },
    ) => {
        const {loadableId, stepId, sessionId, chainProgress, chainResults} = payload
        const resultsByKey = {...get(resultsByKeyAtomFamily(loadableId))}
        const key = buildResultKey(stepId, sessionId)
        const existing = resultsByKey[key]

        if (existing) {
            resultsByKey[key] = {
                ...existing,
                chainProgress,
                ...(chainResults !== undefined ? {chainResults} : {}),
            }
            set(resultsByKeyAtomFamily(loadableId), resultsByKey)
        }
    },
)

// ============================================================================
// COMPOUND EXECUTION ACTIONS
// ============================================================================

interface RunnableNode {
    id: string
    entity: EntitySelection
    depth: number
}

/**
 * Convert PlaygroundNode to RunnableNode format
 */
function toRunnableNode(node: PlaygroundNode): RunnableNode {
    return {
        id: node.id,
        entity: {
            type: node.entityType as EntitySelection["type"],
            id: node.entityId,
            label: node.label,
        },
        depth: "depth" in node && typeof node.depth === "number" ? node.depth : 0,
    }
}

/**
 * Get expected input keys for a runnable
 */
function getExpectedInputKeys(runnableId: string): Set<string> {
    const store = getDefaultStore()
    const inputPortsAtom = runnableBridge.inputPorts(runnableId)
    const inputPorts = store.get(inputPortsAtom)
    return new Set(inputPorts.map((input) => input.key))
}

/**
 * Execute a step for a single session (handles chain execution)
 */
async function executeStepForSession(
    loadableId: string,
    stepId: string,
    session: ExecutionSession,
    data: Record<string, unknown>,
    nodes: PlaygroundNode[],
    primaryNode: PlaygroundNode,
    allConnections: OutputConnection[],
    set: Setter,
): Promise<void> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    // Start the run
    set(startRunAtom, {loadableId, stepId, sessionId: session.id, runId})

    try {
        // Convert nodes to RunnableNode format
        const runnableNodes = nodes.map(toRunnableNode)

        // Check if we have downstream nodes (chain execution)
        const downstreamConnections = allConnections.filter(
            (c) => c.sourceNodeId === primaryNode.id,
        )
        const isChain = downstreamConnections.length > 0

        // Build execution order for chain
        const executionOrder = isChain
            ? computeTopologicalOrder(
                  runnableNodes.map((n) => ({nodeId: n.id})),
                  allConnections,
                  primaryNode.id,
              )
            : [primaryNode.id]

        const totalStages = executionOrder?.length || 1
        const chainResults: Record<string, StageExecutionResult> = {}
        const nodeResults: Record<string, ExecutionResult> = {}

        // Get expected input keys for primary node
        const expectedInputKeys = getExpectedInputKeys(primaryNode.entityId)

        // Execute each node in order
        for (let stageIndex = 0; stageIndex < (executionOrder?.length || 1); stageIndex++) {
            const nodeId = executionOrder?.[stageIndex] || primaryNode.id
            const node = runnableNodes.find((n) => n.id === nodeId)

            if (!node) continue

            const nodeLabel = node.entity.label || `Stage ${stageIndex + 1}`

            // Update progress
            set(updateChainProgressAtom, {
                loadableId,
                stepId,
                sessionId: session.id,
                chainProgress: {
                    currentStage: stageIndex + 1,
                    totalStages,
                    currentNodeId: nodeId,
                    currentNodeLabel: nodeLabel,
                    currentNodeType: node.entity.type,
                },
                chainResults,
            })

            // Resolve inputs for this node
            let nodeInputs: Record<string, unknown>
            if (nodeId === primaryNode.id) {
                // Primary node uses testcase data, filtered to only expected inputs
                nodeInputs = Object.fromEntries(
                    Object.entries(data).filter(([key]) => expectedInputKeys.has(key)),
                )
            } else {
                // Downstream nodes resolve inputs from upstream results
                nodeInputs = resolveChainInputs(allConnections, nodeId, nodeResults, data)
            }

            // Get runnable data from bridge
            const dataAtom = runnableBridge.data(node.entity.id)
            const store = getDefaultStore()
            const runnableData = store.get(dataAtom) as RunnableData | null

            if (!runnableData) {
                throw new Error(`No runnable data for ${node.entity.type}:${node.entity.id}`)
            }

            // Execute the node
            const result = await executeRunnable(node.entity.type as RunnableType, runnableData, {
                inputs: nodeInputs,
            })

            if (!result) {
                throw new Error(`Execution returned null for node ${nodeId}`)
            }

            // Store result
            nodeResults[nodeId] = result
            chainResults[nodeId] = {
                executionId: result.executionId,
                nodeId,
                nodeLabel,
                nodeType: node.entity.type,
                stageIndex,
                status: result.status,
                startedAt: result.startedAt,
                completedAt: result.completedAt,
                output: result.output,
                structuredOutput: result.structuredOutput,
                error: result.error,
                traceId: result.trace?.id || null,
                metrics: result.metrics,
            }

            // Stop on error
            if (result.status === "error") {
                set(failRunAtom, {
                    loadableId,
                    stepId,
                    sessionId: session.id,
                    error: result.error || {message: "Execution failed"},
                })
                return
            }
        }

        // Get primary node result for final output
        const primaryResult = nodeResults[primaryNode.id]

        // Complete the run
        set(completeRunAtom, {
            loadableId,
            stepId,
            sessionId: session.id,
            result: {
                runId,
                output: primaryResult?.output,
                structuredOutput: primaryResult?.structuredOutput,
                metrics: primaryResult?.metrics,
                traceId: primaryResult?.trace?.id || null,
                isChain,
                totalStages,
                chainResults,
            },
        })
    } catch (error) {
        set(failRunAtom, {
            loadableId,
            stepId,
            sessionId: session.id,
            error: {
                message: error instanceof Error ? error.message : String(error),
            },
        })
    }
}

/**
 * Run a step across sessions
 *
 * This is the main execution action that supports multi-session compare mode.
 * It executes the step for each active session (or specified sessions) in parallel.
 *
 * @example
 * const runStep = useSetAtom(runStepAtom)
 * await runStep({
 *     loadableId: "loadable-1",
 *     stepId: "row-123",
 *     data: { prompt: "Hello" }
 * })
 */
export const runStepAtom = atom(
    null,
    async (get, set, payload: {loadableId: string} & RunStepPayload) => {
        const {loadableId, stepId, sessionIds: specifiedSessionIds, data = {}} = payload

        const primaryNode = get(primaryNodeAtom)
        if (!primaryNode) return

        const nodes = get(playgroundNodesAtom)
        const allConnections = get(outputConnectionsAtom) as OutputConnection[]
        const activeSessions = get(activeSessionsAtomFamily(loadableId))

        // Use specified sessions or all active sessions
        const sessionsToRun = specifiedSessionIds
            ? activeSessions.filter((s) => specifiedSessionIds.includes(s.id))
            : activeSessions

        if (sessionsToRun.length === 0) return

        // Execute all sessions in parallel
        await Promise.all(
            sessionsToRun.map((session) =>
                executeStepForSession(
                    loadableId,
                    stepId,
                    session,
                    data,
                    nodes,
                    primaryNode,
                    allConnections,
                    set,
                ),
            ),
        )
    },
)

/**
 * Cancel a step for sessions
 *
 * @example
 * const cancelStep = useSetAtom(cancelStepAtom)
 * cancelStep({ loadableId: "loadable-1", stepId: "step-123" })
 */
export const cancelStepAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & CancelStepPayload) => {
        const {loadableId, stepId, sessionIds} = payload
        const activeSessions = get(activeSessionsAtomFamily(loadableId))

        const sessionsToCancel = sessionIds
            ? activeSessions.filter((s) => sessionIds.includes(s.id))
            : activeSessions

        for (const session of sessionsToCancel) {
            set(cancelRunAtom, {loadableId, stepId, sessionId: session.id})
        }
    },
)

/**
 * Reset execution state
 *
 * Clears all sessions, steps, and results.
 *
 * @example
 * const reset = useSetAtom(resetExecutionAtom)
 * reset({ loadableId: "loadable-1" })
 */
export const resetExecutionAtom = atom(null, (get, set, payload: {loadableId: string}) => {
    const {loadableId} = payload
    const initialMode = get(executionModeAtomFamily(loadableId))

    set(executionStateAtomFamily(loadableId), {
        mode: initialMode,
        sessionsById: {},
        activeSessionIds: [],
        stepsById: {},
        stepIds: [],
        resultsByKey: {},
    })
})

// ============================================================================
// CONTEXT-AWARE ACTIONS (auto-inject loadableId from primary node)
// ============================================================================

/**
 * Derive loadableId from primary node
 */
function deriveLoadableId(primaryNode: PlaygroundNode | null): string {
    if (!primaryNode) return ""
    return `testset:${primaryNode.entityType}:${primaryNode.entityId}`
}

/**
 * Context-aware payload for runStep (without loadableId)
 */
export interface RunStepWithContextPayload {
    /** The step ID (rowId for completion mode) */
    stepId: string
    /** Input data for the step */
    data?: Record<string, unknown>
    /** Optional specific session IDs (defaults to all active) */
    sessionIds?: string[]
}

/**
 * Run a step with automatic loadableId derivation from primary node
 *
 * This is the recommended action for most use cases. It automatically
 * derives the loadableId from the primary node, eliminating the need
 * for callers to construct it manually.
 *
 * @example
 * const runStep = useSetAtom(runStepWithContextAtom)
 * await runStep({ stepId: "row-123", data: { prompt: "Hello" } })
 */
export const runStepWithContextAtom = atom(
    null,
    async (get, set, payload: RunStepWithContextPayload) => {
        const primaryNode = get(primaryNodeAtom)
        const loadableId = deriveLoadableId(primaryNode)

        if (!loadableId) {
            console.warn("runStepWithContext: No primary node available")
            return
        }

        await set(runStepAtom, {
            loadableId,
            ...payload,
        })
    },
)

/**
 * Initialize sessions with automatic loadableId derivation
 *
 * @example
 * const initSessions = useSetAtom(initSessionsWithContextAtom)
 * initSessions({
 *     sessions: [
 *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
 *     ]
 * })
 */
export const initSessionsWithContextAtom = atom(null, (get, set, payload: InitSessionsPayload) => {
    const primaryNode = get(primaryNodeAtom)
    const loadableId = deriveLoadableId(primaryNode)

    if (!loadableId) {
        console.warn("initSessionsWithContext: No primary node available")
        return
    }

    set(initSessionsAtom, {loadableId, ...payload})
})

/**
 * Cancel a step with automatic loadableId derivation
 *
 * @example
 * const cancelStep = useSetAtom(cancelStepWithContextAtom)
 * cancelStep({ stepId: "step-123" })
 */
export const cancelStepWithContextAtom = atom(null, (get, set, payload: CancelStepPayload) => {
    const primaryNode = get(primaryNodeAtom)
    const loadableId = deriveLoadableId(primaryNode)

    if (!loadableId) {
        console.warn("cancelStepWithContext: No primary node available")
        return
    }

    set(cancelStepAtom, {loadableId, ...payload})
})

/**
 * Reset execution with automatic loadableId derivation
 *
 * @example
 * const reset = useSetAtom(resetExecutionWithContextAtom)
 * reset()
 */
export const resetExecutionWithContextAtom = atom(null, (get, set) => {
    const primaryNode = get(primaryNodeAtom)
    const loadableId = deriveLoadableId(primaryNode)

    if (!loadableId) {
        console.warn("resetExecutionWithContext: No primary node available")
        return
    }

    set(resetExecutionAtom, {loadableId})
})
