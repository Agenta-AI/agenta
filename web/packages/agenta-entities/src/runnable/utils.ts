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
    nodes: {nodeId: string}[] | PlaygroundNode[],
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
                // Use prototype-less object to prevent prototype pollution
                const existing = result[mapping.targetKey]
                const targetObj: Record<string, unknown> =
                    existing &&
                    typeof existing === "object" &&
                    existing !== null &&
                    Object.getPrototypeOf(existing) === null
                        ? (existing as Record<string, unknown>)
                        : Object.create(null)
                // keyInObject can be string or string[] - use first element if array
                const keyName = Array.isArray(mapping.keyInObject)
                    ? mapping.keyInObject[0]
                    : mapping.keyInObject
                // Avoid prototype pollution by rejecting dangerous keys
                if (
                    keyName &&
                    keyName !== "__proto__" &&
                    keyName !== "constructor" &&
                    keyName !== "prototype"
                ) {
                    Object.defineProperty(targetObj, keyName, {
                        value,
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    })
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
// TEMPLATE VARIABLE EXTRACTION
// ============================================================================

/**
 * Extract variables from a template string using double curly brace syntax {{variableName}}
 * @param input - Template string to extract variables from
 * @returns Array of unique variable names found in the string
 */
export function extractTemplateVariables(input: string): string[] {
    // Simple pattern: match {{ then one or more non-brace characters, then }}
    // Excludes { and } from variable names to prevent ReDoS backtracking
    const variablePattern = /\{\{([^{}]+)\}\}/g
    const variables: string[] = []

    let match: RegExpExecArray | null
    while ((match = variablePattern.exec(input)) !== null) {
        const variable = match[1].trim()
        if (variable && !variables.includes(variable)) {
            variables.push(variable)
        }
    }

    return variables
}

/**
 * Extract template variables from a JSON object recursively
 * @param obj - Object to extract variables from
 * @returns Array of unique variable names
 */
export function extractTemplateVariablesFromJson(obj: unknown): string[] {
    const variables: string[] = []

    if (typeof obj === "string") {
        return extractTemplateVariables(obj)
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            const itemVars = extractTemplateVariablesFromJson(item)
            for (const v of itemVars) {
                if (!variables.includes(v)) variables.push(v)
            }
        }
    } else if (obj && typeof obj === "object") {
        for (const [key, value] of Object.entries(obj)) {
            // Extract from keys
            const keyVars = typeof key === "string" ? extractTemplateVariables(key) : []
            for (const v of keyVars) {
                if (!variables.includes(v)) variables.push(v)
            }
            // Extract from values
            const valueVars = extractTemplateVariablesFromJson(value)
            for (const v of valueVars) {
                if (!variables.includes(v)) variables.push(v)
            }
        }
    }

    return variables
}

/**
 * Extract template variables from prompt messages
 * Handles both simple string content and complex message arrays
 *
 * @param prompts - Array of prompt objects with messages
 * @returns Array of unique variable names found in all messages
 */
export function extractVariablesFromPrompts(prompts: {messages?: unknown}[] | undefined): string[] {
    if (!prompts || prompts.length === 0) return []

    const variables: string[] = []

    for (const prompt of prompts) {
        const messages = prompt.messages
        if (!Array.isArray(messages)) continue

        for (const message of messages) {
            if (!message || typeof message !== "object") continue

            const msg = message as Record<string, unknown>
            const content = msg.content

            // Handle string content
            if (typeof content === "string") {
                const contentVars = extractTemplateVariables(content)
                for (const v of contentVars) {
                    if (!variables.includes(v)) variables.push(v)
                }
            }
            // Handle array content (multi-part messages)
            else if (Array.isArray(content)) {
                for (const part of content) {
                    if (typeof part === "string") {
                        const partVars = extractTemplateVariables(part)
                        for (const v of partVars) {
                            if (!variables.includes(v)) variables.push(v)
                        }
                    } else if (part && typeof part === "object") {
                        const partObj = part as Record<string, unknown>
                        // Check text field in content parts
                        if (typeof partObj.text === "string") {
                            const textVars = extractTemplateVariables(partObj.text)
                            for (const v of textVars) {
                                if (!variables.includes(v)) variables.push(v)
                            }
                        }
                    }
                }
            }
        }
    }

    return variables
}

/**
 * Extract template variables from agConfig prompt object
 * @param agConfig - The agConfig object containing prompt with messages
 * @returns Array of unique variable names
 */
export function extractVariablesFromAgConfig(
    agConfig: Record<string, unknown> | undefined,
): string[] {
    if (!agConfig) return []

    const prompt = agConfig.prompt as Record<string, unknown> | undefined
    if (!prompt) return []

    const messages = prompt.messages
    if (!Array.isArray(messages)) return []

    return extractVariablesFromPrompts([{messages}])
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
        // Build request body
        // The API expects { inputs: { ... } } format
        // For /test endpoint, also include ag_config to test draft changes
        const isTestEndpoint = data.invocationUrl.endsWith("/test")
        const requestBody: Record<string, unknown> = {inputs}

        if (isTestEndpoint && data.configuration) {
            // Include the draft ag_config for testing uncommitted changes
            requestBody.ag_config = data.configuration
        }

        const response = await fetch(data.invocationUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        })

        if (!response.ok) {
            const errorText = await response.text()
            let errorMessage = `Request failed with status ${response.status}`

            try {
                const errorData = JSON.parse(errorText)
                // New invoke endpoint format: { status: { message, code, type } }
                if (errorData?.status?.message) {
                    errorMessage = errorData.status.message
                }
                // Legacy endpoint format: { detail: { message } }
                else if (errorData?.detail?.message) {
                    errorMessage = errorData.detail.message
                }
                // Legacy endpoint format: { detail: "string" }
                else if (typeof errorData?.detail === "string") {
                    errorMessage = errorData.detail
                }
            } catch {
                // Response is not JSON, use raw text if available
                if (errorText) {
                    errorMessage = errorText
                }
            }

            return {
                executionId,
                status: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                error: {
                    message: errorMessage,
                },
            }
        }

        const responseData = await response.json()

        // Extract the main output from the response
        // API returns { version, data, content_type, tree, trace_id, span_id } - we want "data" as the output
        const output = responseData?.data !== undefined ? responseData.data : responseData

        // Extract trace ID from response.trace_id (at root level, not inside tree)
        const traceId = responseData?.trace_id

        // Debug logging for trace ID extraction
        console.log("[executeRunnable] API response:", {
            executionId,
            hasTree: !!responseData?.tree,
            traceId,
            spanId: responseData?.span_id,
            responseKeys: Object.keys(responseData || {}),
        })

        return {
            executionId,
            status: "success",
            startedAt,
            completedAt: new Date().toISOString(),
            output,
            // Store full response for detailed inspection
            structuredOutput: responseData,
            // Include trace info if available
            trace: traceId ? {id: traceId} : undefined,
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
