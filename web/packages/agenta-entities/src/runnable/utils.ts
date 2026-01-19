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
 * @param nodes - Array of playground nodes
 * @param connections - Output connections between nodes
 * @returns Array of node IDs in execution order
 */
export function computeTopologicalOrder(
    nodes: PlaygroundNode[],
    connections: OutputConnection[],
): string[] {
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    // Initialize
    for (const node of nodes) {
        inDegree.set(node.id, 0)
        adjacency.set(node.id, [])
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

    for (const [nodeId, degree] of inDegree.entries()) {
        if (degree === 0) {
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
 * Resolve chain inputs from mappings and upstream outputs
 *
 * @param mappings - Input mappings for the node
 * @param upstreamOutputs - Outputs from upstream nodes
 * @param testcaseData - Optional testcase data
 * @returns Resolved input data
 */
export function resolveChainInputs(
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
 * Auto-map inputs based on name matching
 *
 * @param targetKeys - Keys to map
 * @param availableSources - Available source paths
 * @returns Input mappings
 */
export function autoMapInputs(
    targetKeys: string[],
    availableSources: Array<{path: string; key: string}>,
): InputMapping[] {
    const mappings: InputMapping[] = []

    for (const targetKey of targetKeys) {
        const match = availableSources.find(
            (source) => source.key.toLowerCase() === targetKey.toLowerCase(),
        )

        if (match) {
            mappings.push({
                targetKey,
                sourcePath: match.path,
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
