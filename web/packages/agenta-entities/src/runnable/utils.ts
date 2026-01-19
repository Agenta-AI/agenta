/**
 * Runnable Utilities
 *
 * Chain execution and input mapping utilities for runnables.
 */

import type {
    RunnableType,
    RunnableData,
    ExecutionResult,
    InputMapping,
    PlaygroundNode,
    OutputConnection,
} from "./types"

// ============================================================================
// TOPOLOGICAL SORT
// ============================================================================

/**
 * Compute topological order for DAG execution
 *
 * @param nodes - Array of nodes with nodeId property
 * @param connections - Output connections between nodes
 * @param startNodeId - Optional starting node ID (ensures it's first)
 * @returns Array of node IDs in execution order
 */
export function computeTopologicalOrder(
    nodes: Array<{nodeId: string}> | PlaygroundNode[],
    connections: OutputConnection[],
    startNodeId?: string,
): string[] {
    // Normalize nodes to get IDs
    const nodeIds = nodes.map((n) => ("nodeId" in n ? n.nodeId : n.id))

    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    // Initialize
    for (const nodeId of nodeIds) {
        inDegree.set(nodeId, 0)
        adjacency.set(nodeId, [])
    }

    // Build graph from connections
    for (const conn of connections) {
        const targets = adjacency.get(conn.sourceNodeId) ?? []
        targets.push(conn.targetNodeId)
        adjacency.set(conn.sourceNodeId, targets)

        const currentInDegree = inDegree.get(conn.targetNodeId) ?? 0
        inDegree.set(conn.targetNodeId, currentInDegree + 1)
    }

    // Kahn's algorithm
    const queue: string[] = []
    const result: string[] = []

    // If startNodeId provided, ensure it's processed first
    if (startNodeId && inDegree.get(startNodeId) === 0) {
        queue.push(startNodeId)
    }

    for (const [nodeId, degree] of inDegree.entries()) {
        if (degree === 0 && nodeId !== startNodeId) {
            queue.push(nodeId)
        }
    }

    while (queue.length > 0) {
        const nodeId = queue.shift()!
        result.push(nodeId)

        for (const neighbor of adjacency.get(nodeId) ?? []) {
            const newDegree = (inDegree.get(neighbor) ?? 1) - 1
            inDegree.set(neighbor, newDegree)

            if (newDegree === 0) {
                queue.push(neighbor)
            }
        }
    }

    return result
}

// ============================================================================
// INPUT RESOLUTION
// ============================================================================

/**
 * Resolve chain inputs from connections and upstream node results
 *
 * @param connections - All output connections in the chain
 * @param targetNodeId - The node to resolve inputs for
 * @param nodeResults - Results from previously executed nodes
 * @param testcaseData - Optional testcase data for testcase.* mappings
 * @returns Resolved input data
 */
export function resolveChainInputs(
    connections: OutputConnection[],
    targetNodeId: string,
    nodeResults: Record<string, ExecutionResult>,
    testcaseData?: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    // Find the connection targeting this node
    const incomingConnection = connections.find((c) => c.targetNodeId === targetNodeId)

    if (!incomingConnection) {
        return result
    }

    const mappings = incomingConnection.inputMappings
    const sourceNodeId = incomingConnection.sourceNodeId
    const sourceResult = nodeResults[sourceNodeId]
    const upstreamOutput = sourceResult?.output ?? sourceResult?.structuredOutput ?? {}

    for (const mapping of mappings) {
        // Check for valid mapping with source path
        if (mapping.status === "valid" && mapping.sourcePath) {
            // Get value from source
            const sourceType = mapping.sourcePath.split(".")[0]
            const sourcePath = mapping.sourcePath.split(".").slice(1)

            let value: unknown

            if (sourceType === "testcase" && testcaseData) {
                value = getValueAtPath(testcaseData, sourcePath)
            } else if (sourceType === "output" || sourceType === "outputs") {
                value = getValueAtPath(upstreamOutput, sourcePath)
            } else {
                // Try to get from upstream output directly
                value = getValueAtPath(upstreamOutput, mapping.sourcePath.split("."))
            }

            // Handle object-type inputs with keyInObject
            if (mapping.keyInObject) {
                const targetObj = (result[mapping.targetKey] as Record<string, unknown>) ?? {}
                // keyInObject can be string or string[] - use first element if array
                const keyName = Array.isArray(mapping.keyInObject)
                    ? mapping.keyInObject[0]
                    : mapping.keyInObject
                if (keyName) {
                    targetObj[keyName] = value
                }
                result[mapping.targetKey] = targetObj
            } else {
                result[mapping.targetKey] = value
            }
        }
        // Unmapped inputs are left undefined
    }

    return result
}

/**
 * Resolve inputs from mappings directly (simpler overload for modal usage)
 *
 * @param mappings - Input mappings for the node
 * @param upstreamOutputs - Outputs from upstream nodes
 * @param testcaseData - Optional testcase data
 * @returns Resolved input data
 */
export function resolveInputsFromMappings(
    mappings: InputMapping[],
    upstreamOutputs: Record<string, unknown>,
    testcaseData?: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const mapping of mappings) {
        // Check for valid mapping with source path
        if (mapping.status === "valid" && mapping.sourcePath) {
            // Get value from source
            const sourceType = mapping.sourcePath.split(".")[0]
            const sourcePath = mapping.sourcePath.split(".").slice(1)

            let value: unknown

            if (sourceType === "testcase" && testcaseData) {
                value = getValueAtPath(testcaseData, sourcePath)
            } else {
                value = getValueAtPath(upstreamOutputs, mapping.sourcePath.split("."))
            }

            result[mapping.targetKey] = value
        }
        // Unmapped inputs are left undefined
    }

    return result
}

/**
 * Get value at a path in an object
 */
function getValueAtPath(obj: unknown, path: string[]): unknown {
    let current = obj
    for (const key of path) {
        if (current == null || typeof current !== "object") {
            return undefined
        }
        current = (current as Record<string, unknown>)[key]
    }
    return current
}

// ============================================================================
// AUTO MAPPING
// ============================================================================

/**
 * Path source info for auto-mapping
 */
export interface PathSource {
    /** Full path string (e.g., "output.result" or "testcase.input") */
    path: string
    /** Key for matching (optional - will extract from path if not provided) */
    key?: string
    /** Display label (optional - used for matching if provided) */
    label?: string
    /** Full path string for display (e.g., "testcase.input") */
    pathString?: string
}

/**
 * Auto-map inputs based on name matching
 *
 * @param targetKeys - Keys to map
 * @param availableSources - Available source paths (PathInfo[] or simpler {path, key}[])
 * @returns Input mappings
 */
export function autoMapInputs(
    targetKeys: string[],
    availableSources: PathSource[],
): InputMapping[] {
    const mappings: InputMapping[] = []

    for (const targetKey of targetKeys) {
        // Try to find a match by key, label, or last segment of path
        const match = availableSources.find((source) => {
            // Match by key if available
            if (source.key && source.key.toLowerCase() === targetKey.toLowerCase()) {
                return true
            }
            // Match by label if available
            if (source.label && source.label.toLowerCase() === targetKey.toLowerCase()) {
                return true
            }
            // Match by last segment of path (e.g., "testcase.input" -> "input")
            const pathKey = source.path.split(".").pop()
            if (pathKey && pathKey.toLowerCase() === targetKey.toLowerCase()) {
                return true
            }
            return false
        })

        if (match) {
            mappings.push({
                targetKey,
                sourcePath: match.pathString || match.path,
                status: "valid",
                isAutoMapped: true,
            })
        } else {
            mappings.push({
                targetKey,
                sourcePath: null,
                status: "unmapped",
            })
        }
    }

    return mappings
}

// ============================================================================
// EXECUTION
// ============================================================================

export interface ExecuteRunnableOptions {
    inputs: Record<string, unknown>
    abortSignal?: AbortSignal
}

/**
 * Execute a runnable with inputs
 *
 * This is a placeholder implementation. The actual execution logic
 * should be provided by the consuming application based on the
 * runnable type and configuration.
 *
 * @param type - Type of runnable (appRevision or evaluatorRevision)
 * @param data - Runnable data including invocation URL
 * @param options - Execution options including inputs
 * @returns Execution result
 */
export async function executeRunnable(
    _type: RunnableType,
    data: RunnableData,
    options: ExecuteRunnableOptions,
): Promise<ExecutionResult> {
    const {inputs, abortSignal} = options
    const executionId = crypto.randomUUID()
    const startedAt = new Date().toISOString()

    // Validate runnable data
    if (!data.invocationUrl) {
        return {
            executionId,
            status: "error",
            startedAt,
            completedAt: new Date().toISOString(),
            error: {
                message: "No invocation URL configured for runnable",
            },
        }
    }

    try {
        // Make request to invocation URL
        const response = await fetch(data.invocationUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(inputs),
            signal: abortSignal,
        })

        if (!response.ok) {
            const errorText = await response.text()
            return {
                executionId,
                status: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                error: {
                    message: `Request failed: ${response.status} ${errorText}`,
                },
            }
        }

        const output = await response.json()

        return {
            executionId,
            status: "success",
            startedAt,
            completedAt: new Date().toISOString(),
            output,
        }
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return {
                executionId,
                status: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                error: {
                    message: "Execution aborted",
                },
            }
        }

        return {
            executionId,
            status: "error",
            startedAt,
            completedAt: new Date().toISOString(),
            error: {
                message: error instanceof Error ? error.message : "Unknown error",
            },
        }
    }
}
