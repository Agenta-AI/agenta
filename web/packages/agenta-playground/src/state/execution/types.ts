/**
 * Execution Module Types
 *
 * Types for multi-session execution, supporting both completion and chat modes.
 * These types extend the existing execution infrastructure to enable:
 * - Compare mode: multiple runnables on same inputs
 * - Chat mode: conversational execution with message history
 *
 * @module execution/types
 */

import type {
    ChainProgress,
    StageExecutionResult,
    RunnableType,
    RunnableData,
    ExecutionMetrics,
    ExecutionResult,
} from "@agenta/entities/runnable"
import type {ExecuteRunnableOptions} from "@agenta/entities/runnable"

// ============================================================================
// EXECUTION MODE
// ============================================================================

/**
 * Execution mode determines how inputs are structured
 * - "completion": Traditional testcase-based execution (variables/text input)
 * - "chat": Conversational execution with message history
 */
export type ExecutionMode = "chat" | "completion"

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * An execution session represents a runnable instance in the playground
 *
 * Sessions enable compare mode by allowing multiple runnables to be executed
 * with the same inputs. Each session maintains its own execution state.
 *
 * @example
 * const session: ExecutionSession = {
 *     id: "sess:rev-abc123",
 *     runnableId: "rev-abc123",
 *     runnableType: "appRevision",
 *     mode: "completion",
 *     label: "v1.2.0"
 * }
 */
export interface ExecutionSession {
    /** Unique session ID. Format: "sess:<runnableId>" */
    id: string
    /** The runnable entity ID this session represents */
    runnableId: string
    /** Type of runnable (appRevision or evaluatorRevision) */
    runnableType: RunnableType
    /** Execution mode for this session */
    mode: ExecutionMode
    /** Display label for the session (shown in UI columns) */
    label?: string
    /** Additional metadata for the session */
    meta?: Record<string, unknown>
}

// ============================================================================
// STEP/INPUT TYPES
// ============================================================================

/**
 * Input for a chat mode execution step
 */
export interface ChatExecutionInput {
    kind: "chat"
    role: "user" | "system" | "assistant"
    content: string | unknown[]
}

/**
 * Input for a completion mode execution step
 */
export interface CompletionExecutionInput {
    kind: "completion"
    /** Raw text input (for simple prompts) */
    text?: string
    /** Variable values (for templated prompts) */
    variables?: Record<string, unknown>
}

/**
 * Union type for execution inputs
 * Discriminated by the `kind` field
 */
export type ExecutionInput = ChatExecutionInput | CompletionExecutionInput

/**
 * An execution step represents a single input to be executed
 *
 * In completion mode: each testcase row becomes a step (id = rowId)
 * In chat mode: each user message becomes a step (id = "step-<uuid>")
 *
 * @example
 * // Completion mode step
 * const step: ExecutionStep = {
 *     id: "row-123",
 *     input: { kind: "completion", variables: { prompt: "Hello" } },
 *     createdAt: Date.now()
 * }
 *
 * // Chat mode step
 * const chatStep: ExecutionStep = {
 *     id: "step-abc",
 *     input: { kind: "chat", role: "user", content: "What is 2+2?" },
 *     createdAt: Date.now()
 * }
 */
export interface ExecutionStep {
    /** Unique step ID. Completion: rowId; Chat: "step-<uuid>" */
    id: string
    /** The input for this step */
    input: ExecutionInput
    /** Timestamp when step was created */
    createdAt: number
    /** Additional metadata */
    meta?: Record<string, unknown>
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Run status - extends ExecutionStatus with "pending" for pre-start state
 */
export type RunStatus = "idle" | "pending" | "running" | "success" | "error" | "cancelled"

/**
 * Result of executing a step for a specific session
 *
 * Results are stored with composite key: "${stepId}:${sessionId}"
 * This enables comparing results across multiple sessions for the same input.
 *
 * @example
 * const result: RunResult = {
 *     status: "success",
 *     sessionId: "sess:rev-abc123",
 *     runId: "run-xyz",
 *     traceId: "trace-123",
 *     output: { response: "Hello!" },
 *     metrics: { latencyMs: 150 },
 *     startedAt: 1706000000000,
 *     completedAt: 1706000000150
 * }
 */
export interface RunResult {
    /** Current status of the execution */
    status: RunStatus
    /** Session ID this result belongs to */
    sessionId: string
    /** Unique run ID for this execution */
    runId?: string
    /** Trace ID for fetching detailed span data */
    traceId?: string | null
    /** Hash of result for comparison (optional) */
    resultHash?: string | null
    /** Error details if status is "error" */
    error?: {message: string; code?: string} | null
    /** Timestamp when execution started (ms) */
    startedAt?: number
    /** Timestamp when execution completed (ms) */
    completedAt?: number
    /** Execution output */
    output?: unknown
    /** Structured output (parsed JSON, etc.) */
    structuredOutput?: unknown
    /** Execution metrics (latency, tokens, cost) */
    metrics?: ExecutionMetrics
    /** Chain execution progress (while running) */
    chainProgress?: ChainProgress | null
    /** Results from all nodes keyed by nodeId (for chain execution) */
    chainResults?: Record<string, StageExecutionResult>
    /** Whether this execution involves a chain */
    isChain?: boolean
    /** Total number of stages in the chain */
    totalStages?: number
    /** Per-repetition results when repetitionCount > 1 */
    repetitions?: {
        output?: unknown
        structuredOutput?: unknown
        metrics?: ExecutionMetrics
        traceId?: string | null
        chainResults?: Record<string, StageExecutionResult>
    }[]
}

// ============================================================================
// ACTION PAYLOADS
// ============================================================================

/**
 * Payload for initializing sessions
 */
export interface InitSessionsPayload {
    sessions: ExecutionSession[]
}

/**
 * Per-session execution options passed through to the adapter.
 *
 * Allows callers (e.g., the OSS playground trigger) to supply a pre-built
 * request body and/or custom headers on a per-session basis. This is the
 * key mechanism for the "thin OSS trigger" pattern where data gathering
 * happens in OSS, but orchestration is delegated to the package controller.
 */
export interface SessionExecutionOptions {
    /** Pre-built HTTP request body — bypasses default body construction */
    rawBody?: Record<string, unknown>
    /** HTTP headers for the request (e.g., Authorization) */
    headers?: Record<string, string>
}

/**
 * Payload for running a step
 */
export interface RunStepPayload {
    /** Step ID to execute */
    stepId: string
    /** Session IDs to execute (defaults to all active sessions) */
    sessionIds?: string[]
    /** Input data (for completion mode, overrides step input) */
    data?: Record<string, unknown>
    /** Per-session options passed through to the adapter. Keyed by sessionId. */
    sessionOptions?: Record<string, SessionExecutionOptions>
    /** When set, only execute this specific node instead of the full chain */
    targetNodeId?: string
}

/**
 * Payload for adding a step (chat mode)
 */
export interface AddStepPayload {
    /** Step input */
    input: ExecutionInput
    /** Custom step ID (optional, auto-generated if not provided) */
    id?: string
}

/**
 * Payload for cancelling a step
 */
export interface CancelStepPayload {
    /** Step ID to cancel */
    stepId: string
    /** Session IDs to cancel (defaults to all running sessions for this step) */
    sessionIds?: string[]
}

// ============================================================================
// STATE SHAPE
// ============================================================================

/**
 * Execution state shape for a single loadable instance
 *
 * This is the normalized state structure for the execution module.
 */
export interface ExecutionState {
    /** Current execution mode */
    mode: ExecutionMode
    /** All sessions by ID */
    sessionsById: Record<string, ExecutionSession>
    /** Active session IDs (for compare mode) */
    activeSessionIds: string[]
    /** All steps by ID */
    stepsById: Record<string, ExecutionStep>
    /** Step IDs in order */
    stepIds: string[]
    /** Results keyed by "${stepId}:${sessionId}" */
    resultsByKey: Record<string, RunResult>
}

/**
 * Initial execution state factory
 */
export function createInitialExecutionState(): ExecutionState {
    return {
        mode: "completion",
        sessionsById: {},
        activeSessionIds: [],
        stepsById: {},
        stepIds: [],
        resultsByKey: {},
    }
}

// ============================================================================
// EXECUTION ADAPTER
// ============================================================================

/**
 * Injectable execution adapter
 *
 * Allows the consuming application to customize how runnables are executed.
 * The default adapter uses `executeRunnable()` from `@agenta/entities/runnable`
 * which makes a direct HTTP POST call. Consumers can inject a custom adapter
 * to route execution through web workers, add streaming support, or apply
 * custom data transformations.
 *
 * @example
 * ```typescript
 * import { executionAdapterAtom } from '@agenta/playground'
 * import { getDefaultStore } from 'jotai/vanilla'
 *
 * // Set a custom adapter (e.g., web worker-backed)
 * const store = getDefaultStore()
 * store.set(executionAdapterAtom, {
 *     execute: async (type, data, options) => {
 *         // Custom execution logic (web worker, streaming, etc.)
 *         return myWebWorkerExecute(type, data, options)
 *     },
 *     cancel: (runId) => {
 *         myWebWorkerCancel(runId)
 *     },
 * })
 * ```
 */
// Generic test result shape used by Playground UIs (legacy compat)
export interface PlaygroundTestResult {
    response?: unknown
    error?: string
    metadata?: Record<string, unknown>
}

export interface ExecutionAdapter {
    /** Execute a runnable with the given inputs */
    execute(
        type: RunnableType,
        data: RunnableData,
        options: ExecuteRunnableOptions,
    ): Promise<ExecutionResult>
    /** Cancel a running execution by runId (optional) */
    cancel?: (runId: string) => void
}

/**
 * Parameters for cancelling tests.
 * If no entity IDs are specified, cancels across all displayed entities.
 */
export interface CancelTestsParams {
    rowId?: string
    entityId?: string
    entityIds?: string[]
    reason?: string
}
