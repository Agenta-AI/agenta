/**
 * Playground Entity Types
 *
 * Type definitions for the playground state management system.
 */

// ============================================================================
// ENTITY TYPES
// ============================================================================

/**
 * Types of entities that can be added to the playground
 */
export type EntityType =
    | "appRevision"
    | "ossAppRevision"
    | "evaluatorRevision"
    | "testcase"
    | "span"

/**
 * Types of runnables (entities that can be executed)
 */
export type RunnableType = "appRevision" | "ossAppRevision" | "evaluatorRevision"

/**
 * Entity selection result from the entity selector modal
 */
export interface EntitySelection {
    type: EntityType
    id: string
    label?: string
    metadata?: Record<string, unknown>
}

/**
 * Configuration for the entity selector modal
 */
export interface EntitySelectorConfig {
    /** Modal title */
    title?: string
    /** Entity types to show in the selector */
    allowedTypes?: EntityType[]
    /** Default entity type to show */
    defaultType?: EntityType
}

// ============================================================================
// NODE TYPES
// ============================================================================

/**
 * A node in the playground DAG
 */
export interface PlaygroundNode {
    id: string
    entityType: EntityType
    entityId: string
    label?: string
    depth: number
}

/**
 * Extra column added by the user (not from runnable schema)
 */
export interface ExtraColumn {
    key: string
    name: string
    type: string
}

/**
 * Connected testset info
 */
export interface ConnectedTestset {
    id: string | null
    name: string | null
}

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * Status of an input mapping
 */
export type InputMappingStatus =
    | "valid"
    | "invalid"
    | "unmapped"
    | "missing_source"
    | "type_mismatch"

/**
 * An input mapping from source output to target input
 */
export interface InputMapping {
    /** Target input key */
    targetKey: string
    /** @deprecated Use targetKey instead */
    targetInputKey?: string
    /** Source path (e.g., "output.result" or "testcase.input") */
    sourcePath: string | null
    /** @deprecated Use sourcePath instead - can be string or array for nested paths */
    keyInObject?: string | string[]
    /** Validation status */
    status: InputMappingStatus
    /** Whether this mapping was auto-generated */
    isAutoMapped?: boolean
}

/**
 * A connection between two nodes
 */
export interface OutputConnection {
    id: string
    sourceNodeId: string
    targetNodeId: string
    sourceOutputKey: string
    inputMappings: InputMapping[]
}

// ============================================================================
// TESTSET/LOADABLE TYPES
// ============================================================================

/**
 * A testset row (testcase)
 */
export interface TestsetRow {
    id: string
    data: Record<string, unknown>
    /** Optional label for the row */
    label?: string
}

/**
 * A testset column definition
 */
export interface TestsetColumn {
    key: string
    name: string
    type?: string
    required?: boolean
    /** Default value for this column */
    defaultValue?: unknown
    /** Whether this column should be rendered as multiline */
    multiline?: boolean
}

// ============================================================================
// EXECUTION TYPES
// ============================================================================

/**
 * Execution status
 */
export type ExecutionStatus = "idle" | "pending" | "running" | "success" | "error" | "cancelled"

/**
 * Trace info from execution
 */
export interface TraceInfo {
    id: string
    spanId?: string
}

/**
 * Metrics from execution
 */
export interface ExecutionMetrics {
    latencyMs?: number
    tokenUsage?: {
        input?: number
        output?: number
        total?: number
    }
    cost?: number
    [key: string]: unknown
}

/**
 * Result from a single runnable execution
 */
export interface ExecutionResult {
    executionId: string
    status: ExecutionStatus
    startedAt: string
    completedAt?: string
    output?: unknown
    structuredOutput?: unknown
    error?: {
        message: string
        code?: string
    }
    trace?: TraceInfo
    metrics?: ExecutionMetrics
}

/**
 * Result from a single stage in a chain execution
 */
export interface StageExecutionResult {
    executionId: string
    nodeId: string
    nodeLabel: string
    nodeType: string
    stageIndex: number
    status: ExecutionStatus
    startedAt: string
    completedAt?: string
    output?: unknown
    structuredOutput?: unknown
    error?: {
        message: string
        code?: string
    }
    traceId: string | null
    metrics?: ExecutionMetrics
}

/**
 * Chain execution progress info
 */
export interface ChainProgress {
    currentStage: number
    totalStages: number
    currentNodeId: string
    currentNodeLabel: string
    currentNodeType: string
}

/**
 * Alias for ChainProgress for backwards compatibility
 */
export type ChainExecutionProgress = ChainProgress

/**
 * Row-level execution result with chain support
 */
export interface RowExecutionResult {
    rowId: string
    executionId: string
    startedAt: string
    completedAt?: string
    status: ExecutionStatus
    output?: unknown
    error?: {
        message: string
        code?: string
    }
    metrics?: ExecutionMetrics
    /** Trace ID for fetching structured span data */
    traceId?: string | null
    /** Chain execution progress (while running) */
    chainProgress?: ChainProgress | null
    /** Results from all nodes keyed by nodeId */
    chainResults?: Record<string, StageExecutionResult>
    /** Whether this is a chain execution */
    isChain?: boolean
    /** Total number of stages */
    totalStages?: number
}

// ============================================================================
// RUNNABLE TYPES
// ============================================================================

/**
 * Input port definition for a runnable
 */
export interface RunnableInputPort {
    key: string
    name: string
    type: string
    required: boolean
    description?: string
    /** Current value (if set) */
    value?: unknown
    /** Default value */
    defaultValue?: unknown
}

/**
 * Output port definition for a runnable
 */
export interface RunnableOutputPort {
    key: string
    name: string
    type: string
    description?: string
    /** JSON schema for this output */
    schema?: Record<string, unknown>
    /** Available paths for mapping from this output */
    availablePaths?: PathInfo[]
}

/**
 * Generic runnable data (app revision or evaluator revision)
 */
export interface RunnableData {
    id: string
    type: RunnableType
    name?: string
    label?: string
    description?: string
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    inputPorts: RunnableInputPort[]
    outputPorts: RunnableOutputPort[]
    configuration?: Record<string, unknown>
    invocationUrl?: string
}

/**
 * App revision specific data
 */
export interface AppRevisionData extends RunnableData {
    type: "appRevision"
    appId?: string
    variantId?: string
    variantSlug?: string
    version?: number
    /** Alias for version - used by Version component */
    revision?: number
}

/**
 * Evaluator revision specific data
 */
export interface EvaluatorRevisionData extends RunnableData {
    type: "evaluatorRevision"
    evaluatorId?: string
    variantId?: string
    version?: number
}

// ============================================================================
// PATH INFO TYPES (for input mapping)
// ============================================================================

/**
 * Information about a data path for input mapping
 */
export interface PathInfo {
    /** Full path string (e.g., "output.result.score") */
    path: string
    /** Display string for the path (may include source prefix) */
    pathString?: string
    /** Display label */
    label: string
    /** Data type at this path */
    type: string
    /** Value type for display purposes */
    valueType?: string
    /** Source category ("output" or "testcase") */
    source: "output" | "testcase"
    /** Sample value at this path */
    sampleValue?: unknown
}

/**
 * Extended path info with additional display properties
 */
export interface ExtendedPathInfo extends PathInfo {
    /** Full path string for display (e.g., "testcase.input") */
    pathString: string
    /** Value type for type matching */
    valueType: string
}

/**
 * PathItem for DrillIn navigation (re-exported for convenience)
 */
export interface PathItem {
    key: string
    name: string
    value: unknown
}

// ============================================================================
// PLAYGROUND STATE
// ============================================================================

/**
 * Main playground state
 */
export interface PlaygroundState {
    nodes: PlaygroundNode[]
    selectedNodeId: string | null
    connectedTestset: ConnectedTestset | null
    extraColumns: ExtraColumn[]
    testsetModalOpen: boolean
    mappingModalOpen: boolean
    editingConnectionId: string | null
}

/**
 * Playground action types for dispatch
 */
export type PlaygroundAction =
    | {type: "addNode"; node: PlaygroundNode}
    | {type: "removeNode"; nodeId: string}
    | {type: "selectNode"; nodeId: string | null}
    | {type: "setConnectedTestset"; name: string | null; id: string | null}
    | {type: "clearConnectedTestset"}
    | {type: "addExtraColumn"; key: string; name: string}
    | {type: "removeExtraColumn"; key: string}
    | {type: "openModal"; modal: "testset" | "mapping"; connectionId?: string}
    | {type: "closeModal"; modal: "testset" | "mapping"}
    | {type: "reset"}
