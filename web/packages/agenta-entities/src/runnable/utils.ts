/**
 * Runnable Utilities
 *
 * Chain execution and input mapping utilities for runnables.
 */

import {getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getValueAtPath} from "@agenta/shared/utils"
import {getDefaultStore} from "jotai/vanilla"

import {parseEvaluatorKeyFromUri} from "../workflow/core"

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

/**
 * Like computeTopologicalOrder but groups nodes into execution batches
 * that respect connection-level parallelism.
 *
 * Returns `string[][]` where each inner array is a batch of nodes.
 * Nodes within the same batch execute concurrently via `Promise.all`;
 * batches execute sequentially.
 *
 * Within each BFS depth level, nodes are partitioned:
 * - **Parallel batch**: nodes whose ALL incoming connections have `parallel: true`
 *   are grouped into a single batch.
 * - **Sequential slots**: each node with any non-parallel incoming connection
 *   gets its own single-element batch.
 *
 * Example: App →(parallel) [Eval1, Eval2, Eval3]
 *   → [["app"], ["eval1", "eval2", "eval3"]]
 *
 * Example: App →(sequential) App2 →(parallel) [Eval1, Eval2]
 *   → [["app"], ["app2"], ["eval1", "eval2"]]
 */
export function computeTopologicalLevels(
    nodes: {nodeId: string}[] | PlaygroundNode[],
    connections: OutputConnection[],
    startNodeId?: string,
): string[][] {
    const nodeIds = nodes.map((n) => ("nodeId" in n ? n.nodeId : n.id))

    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    for (const nodeId of nodeIds) {
        inDegree.set(nodeId, 0)
        adjacency.set(nodeId, [])
    }

    // Build a lookup of incoming connections per target node
    const incomingByTarget = new Map<string, OutputConnection[]>()
    for (const conn of connections) {
        const targets = adjacency.get(conn.sourceNodeId) ?? []
        targets.push(conn.targetNodeId)
        adjacency.set(conn.sourceNodeId, targets)

        const currentInDegree = inDegree.get(conn.targetNodeId) ?? 0
        inDegree.set(conn.targetNodeId, currentInDegree + 1)

        const incoming = incomingByTarget.get(conn.targetNodeId) ?? []
        incoming.push(conn)
        incomingByTarget.set(conn.targetNodeId, incoming)
    }

    const queue: string[] = []

    if (startNodeId && inDegree.get(startNodeId) === 0) {
        queue.push(startNodeId)
    }

    for (const [nodeId, degree] of inDegree.entries()) {
        if (degree === 0 && nodeId !== startNodeId) {
            queue.push(nodeId)
        }
    }

    const batches: string[][] = []

    while (queue.length > 0) {
        const levelSize = queue.length
        const bfsLevel: string[] = []

        for (let i = 0; i < levelSize; i++) {
            const nodeId = queue.shift()!
            bfsLevel.push(nodeId)

            for (const neighbor of adjacency.get(nodeId) ?? []) {
                const newDegree = (inDegree.get(neighbor) ?? 1) - 1
                inDegree.set(neighbor, newDegree)

                if (newDegree === 0) {
                    queue.push(neighbor)
                }
            }
        }

        // Partition this BFS level into parallel vs sequential nodes.
        // A node is "parallel-safe" when ALL its incoming connections
        // have `parallel: true`.
        const parallelBatch: string[] = []
        const sequentialNodes: string[] = []

        for (const nodeId of bfsLevel) {
            const incoming = incomingByTarget.get(nodeId)
            const allParallel = incoming?.length
                ? incoming.every((c) => c.parallel === true)
                : false

            if (allParallel) {
                parallelBatch.push(nodeId)
            } else {
                sequentialNodes.push(nodeId)
            }
        }

        // Sequential nodes each become their own batch
        for (const nodeId of sequentialNodes) {
            batches.push([nodeId])
        }

        // Parallel-safe nodes share a single batch
        if (parallelBatch.length > 0) {
            batches.push(parallelBatch)
        }
    }

    return batches
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
        console.debug(`[resolveChainInputs] No incoming connection for node ${targetNodeId}`)
        return result
    }

    const mappings = incomingConnection.inputMappings
    const sourceNodeId = incomingConnection.sourceNodeId
    const sourceResult = nodeResults[sourceNodeId]
    const upstreamOutput = sourceResult?.output ?? sourceResult?.structuredOutput ?? {}

    console.debug(`[resolveChainInputs] Node ${targetNodeId}`, {
        connectionId: incomingConnection.id,
        sourceNodeId,
        mappingCount: mappings.length,
        mappings: mappings.map((m) => ({
            targetKey: m.targetKey,
            sourcePath: m.sourcePath,
            status: m.status,
        })),
        hasUpstreamResult: !!sourceResult,
        testcaseDataKeys: testcaseData ? Object.keys(testcaseData) : [],
    })

    // When there are no explicit input mappings (e.g., evaluators whose input
    // schema has no fixed properties), fall back to the DebugSection pattern:
    // pass through all testcase data + upstream output as prediction/outputs.
    const hasValidMappings = mappings.some((m) => m.status === "valid" && m.sourcePath)
    if (!hasValidMappings) {
        // Spread testcase data first (ground truth, correct_answer, etc.)
        if (testcaseData) {
            Object.assign(result, testcaseData)
        }

        // Normalize upstream output to a string for the prediction field
        const predictionValue =
            typeof upstreamOutput === "string"
                ? upstreamOutput
                : typeof upstreamOutput === "object" && upstreamOutput !== null
                  ? JSON.stringify(upstreamOutput)
                  : String(upstreamOutput ?? "")

        result.prediction = predictionValue
        result.outputs = upstreamOutput

        return result
    }

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

type TemplateFormat = "curly" | "fstring" | "jinja2"

/** Normalize a raw template_format string to a known TemplateFormat, or null if unrecognized. */
function resolveTemplateFormat(raw: string | null | undefined): TemplateFormat | null {
    if (raw === "fstring") return "fstring"
    if (raw === "jinja2" || raw === "jinja") return "jinja2"
    if (raw === "curly") return "curly"
    return null
}

/**
 * Extract variables from a template string.
 *
 * Supports multiple template formats:
 * - "curly" (default): {{variableName}}
 * - "jinja2": {{variableName}} (blocks {% %} and comments {# #} are ignored — they are not variables)
 * - "fstring": {variableName} (single braces; literal braces escaped as {{ / }})
 *
 * @param input - Template string to extract variables from
 * @param templateFormat - Template format to use for extraction
 * @returns Array of unique variable names found in the string
 */
export function extractTemplateVariables(
    input: string,
    templateFormat: TemplateFormat = "curly",
): string[] {
    const variables: string[] = []

    if (templateFormat === "fstring") {
        // fstring: {var} is a variable, {{ and }} are literal braces (not variables)
        // Linear scan: find each '{', skip if doubled '{{', otherwise read until '}'
        let i = 0
        while (i < input.length) {
            if (input[i] === "{") {
                if (input[i + 1] === "{") {
                    // Escaped literal '{{', skip both
                    i += 2
                    continue
                }
                // Single '{' — look for closing '}'
                const end = input.indexOf("}", i + 1)
                if (end !== -1 && (end + 1 >= input.length || input[end + 1] !== "}")) {
                    const variable = input.slice(i + 1, end).trim()
                    if (variable && !variables.includes(variable)) {
                        variables.push(variable)
                    }
                    i = end + 1
                } else {
                    i++
                }
            } else {
                i++
            }
        }
        return variables
    }

    // curly and jinja2 both use {{variableName}} for variable substitution
    // Linear scan: find '{{', then find '}}', extract the content between them
    let i = 0
    while (i < input.length - 1) {
        if (input[i] === "{" && input[i + 1] === "{") {
            const start = i + 2
            const end = input.indexOf("}}", start)
            if (end !== -1) {
                const variable = input.slice(start, end).trim()
                if (variable && !variables.includes(variable)) {
                    variables.push(variable)
                }
                i = end + 2
            } else {
                // No closing '}}' found, no more variables possible
                break
            }
        } else {
            i++
        }
    }

    return variables
}

/**
 * Extract template variables from a JSON object recursively
 * @param obj - Object to extract variables from
 * @returns Array of unique variable names
 */
export function extractTemplateVariablesFromJson(
    obj: unknown,
    templateFormat: TemplateFormat = "curly",
): string[] {
    const variables: string[] = []

    if (typeof obj === "string") {
        return extractTemplateVariables(obj, templateFormat)
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            const itemVars = extractTemplateVariablesFromJson(item, templateFormat)
            for (const v of itemVars) {
                if (!variables.includes(v)) variables.push(v)
            }
        }
    } else if (obj && typeof obj === "object") {
        for (const [key, value] of Object.entries(obj)) {
            // Extract from keys
            const keyVars =
                typeof key === "string" ? extractTemplateVariables(key, templateFormat) : []
            for (const v of keyVars) {
                if (!variables.includes(v)) variables.push(v)
            }
            // Extract from values
            const valueVars = extractTemplateVariablesFromJson(value, templateFormat)
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
export function extractVariablesFromPrompts(
    prompts: {messages?: unknown}[] | undefined,
    templateFormat: TemplateFormat = "curly",
): string[] {
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
                const contentVars = extractTemplateVariables(content, templateFormat)
                for (const v of contentVars) {
                    if (!variables.includes(v)) variables.push(v)
                }
            }
            // Handle array content (multi-part messages)
            else if (Array.isArray(content)) {
                for (const part of content) {
                    if (typeof part === "string") {
                        const partVars = extractTemplateVariables(part, templateFormat)
                        for (const v of partVars) {
                            if (!variables.includes(v)) variables.push(v)
                        }
                    } else if (part && typeof part === "object") {
                        const partObj = part as Record<string, unknown>
                        // Check text field in content parts
                        if (typeof partObj.text === "string") {
                            const textVars = extractTemplateVariables(partObj.text, templateFormat)
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
 * Extract template variables from config prompt objects.
 *
 * Scans all top-level prompt-like entries in config for:
 * 1. Message content templates ({{var}})
 * 2. llm_config.response_format JSON schemas
 * 3. llm_config.tools — function names, descriptions, parameter schemas
 *
 * @param config - The config object containing prompt(s) with messages/llm_config
 * @returns Array of unique variable names
 */
export function extractVariablesFromConfig(
    agConfig: Record<string, unknown> | undefined,
): string[] {
    if (!agConfig) return []

    const variables: string[] = []
    const addUnique = (v: string) => {
        if (!variables.includes(v)) variables.push(v)
    }

    for (const value of Object.values(agConfig)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        const prompt = value as Record<string, unknown>

        // Auto-detect template_format from the prompt object
        const rawTf = (prompt.template_format ?? prompt.templateFormat) as string | undefined
        const tf = resolveTemplateFormat(rawTf) ?? "curly"

        // 1. Extract from messages
        if (Array.isArray(prompt.messages)) {
            extractVariablesFromPrompts([{messages: prompt.messages}], tf).forEach(addUnique)
        }

        // 2. Extract from llm_config: response_format and tools
        const llmConfig = (prompt.llm_config ?? prompt.llmConfig) as
            | Record<string, unknown>
            | undefined
        if (!llmConfig || typeof llmConfig !== "object") continue

        const responseFormat = llmConfig.response_format ?? llmConfig.responseFormat
        if (responseFormat) {
            extractTemplateVariablesFromJson(responseFormat, tf).forEach(addUnique)
        }

        if (Array.isArray(llmConfig.tools)) {
            for (const tool of llmConfig.tools) {
                if (!tool || typeof tool !== "object") continue
                const t = tool as Record<string, unknown>

                // OpenAI function tool: {function: {name, description, parameters}}
                const fn = t.function as Record<string, unknown> | undefined
                if (fn) {
                    if (typeof fn.name === "string") {
                        extractTemplateVariables(fn.name, tf).forEach(addUnique)
                    }
                    if (typeof fn.description === "string") {
                        extractTemplateVariables(fn.description, tf).forEach(addUnique)
                    }
                    if (fn.parameters) {
                        extractTemplateVariablesFromJson(fn.parameters, tf).forEach(addUnique)
                    }
                }

                // Generic tool: {description, parameters}
                if (typeof t.description === "string") {
                    extractTemplateVariables(t.description, tf).forEach(addUnique)
                }
                if (t.parameters && !fn) {
                    extractTemplateVariablesFromJson(t.parameters, tf).forEach(addUnique)
                }
            }
        }
    }

    return variables
}

/**
 * Synchronize `input_keys` for prompt configs in a parameters object.
 *
 * Supports both wrapped params (`{ag_config: {...}}`) and direct config objects.
 * Only prompt configs with a `messages` array are updated.
 */
export function syncPromptInputKeysInParameters(
    parameters: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
    if (parameters == null) return parameters

    const agConfig = parameters.ag_config
    if (agConfig && typeof agConfig === "object" && !Array.isArray(agConfig)) {
        const synced = syncPromptInputKeysInConfig(agConfig as Record<string, unknown>)
        return synced !== agConfig ? {...parameters, ag_config: synced} : parameters
    }

    return syncPromptInputKeysInConfig(parameters)
}

function syncPromptInputKeysInConfig(config: Record<string, unknown>): Record<string, unknown> {
    let changed = false
    const result = {...config}

    for (const [key, value] of Object.entries(result)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue

        const promptConfig = value as Record<string, unknown>
        if (!Array.isArray(promptConfig.messages)) continue

        const variables = extractVariablesFromConfig({[key]: promptConfig})
        const existing = promptConfig.input_keys

        if (
            Array.isArray(existing) &&
            existing.length === variables.length &&
            existing.every((existingKey, index) => existingKey === variables[index])
        ) {
            continue
        }

        result[key] = {...promptConfig, input_keys: variables}
        changed = true
    }

    return changed ? result : config
}

// ============================================================================
// EVALUATOR INPUT CONSTRUCTION
// ============================================================================

/**
 * Context provided to the evaluator for building its execution inputs.
 * The caller (execution runner) supplies upstream results and testcase data;
 * the evaluator entity decides how to assemble them into `inputs`.
 */
export interface EvaluatorInputContext {
    /** Testcase row data (e.g. {question, correct_answer, ...}) */
    testcaseData: Record<string, unknown>
    /** Raw output from the upstream (primary) node */
    upstreamOutput: unknown
    /** Evaluator's configuration / parameters (settings) */
    settings: Record<string, unknown>
    /**
     * The evaluator's input schema from the inspect response.
     * When provided, inputs are built dynamically from schema properties
     * instead of using hardcoded field names.
     *
     * Expected shape: `{ type: "object", properties: {...}, additionalProperties?: boolean }`
     */
    inputSchema?: Record<string, unknown> | null
}

/** Known input keys that map to upstream output */
const UPSTREAM_OUTPUT_KEYS = new Set(["outputs", "prediction"])

/** Known input keys that map to the testcase data as a whole object */
const TESTCASE_OBJECT_KEYS = new Set(["inputs"])

/**
 * Build evaluator execution inputs using the evaluator's input schema.
 *
 * When `inputSchema` is provided (from the inspect response), inputs are built
 * dynamically by iterating over the schema's `properties`:
 *
 * 1. For each schema property, check if a corresponding `{key}_key` setting
 *    exists (e.g., `correct_answer` input ← `correct_answer_key` setting).
 *    If so, use the setting's value as the testcase column name to look up.
 * 2. If the property matches a known upstream output key (`outputs`, `prediction`),
 *    use the normalized upstream output.
 * 3. Otherwise, try to find the value directly in testcase data.
 * 4. If the schema allows `additionalProperties`, spread remaining testcase data.
 *
 * When `inputSchema` is not available, falls back to legacy behavior:
 * spread testcase data + prediction + ground_truth from correct_answer_key.
 *
 * @returns The `inputs` object to send in `{ inputs, settings }` to the evaluator endpoint.
 */
export function buildEvaluatorExecutionInputs(ctx: EvaluatorInputContext): Record<string, unknown> {
    const {testcaseData, upstreamOutput, settings, inputSchema} = ctx

    const prediction = normalizeCompact(upstreamOutput)

    const schemaProperties =
        inputSchema?.properties && typeof inputSchema.properties === "object"
            ? (inputSchema.properties as Record<string, unknown>)
            : null

    console.debug("[buildEvaluatorExecutionInputs]", {
        hasInputSchema: !!schemaProperties,
        schemaPropertyKeys: schemaProperties ? Object.keys(schemaProperties) : [],
        testcaseDataKeys: Object.keys(testcaseData),
        settingsKeys: Object.keys(settings),
        upstreamOutputType: typeof upstreamOutput,
    })

    if (schemaProperties) {
        return buildFromSchema({
            schemaProperties,
            inputSchema: inputSchema!,
            testcaseData,
            upstreamOutput,
            prediction,
            settings,
        })
    }

    // Legacy fallback — no schema available
    return buildLegacy({testcaseData, prediction, settings})
}

/**
 * Schema-driven input construction.
 * Iterates schema properties and resolves each input from settings, upstream output, or testcase data.
 */
function buildFromSchema(ctx: {
    schemaProperties: Record<string, unknown>
    inputSchema: Record<string, unknown>
    testcaseData: Record<string, unknown>
    upstreamOutput: unknown
    prediction: string
    settings: Record<string, unknown>
}): Record<string, unknown> {
    const {schemaProperties, inputSchema, testcaseData, upstreamOutput, prediction, settings} = ctx
    const inputs: Record<string, unknown> = {}

    for (const key of Object.keys(schemaProperties)) {
        // 1. Check for a corresponding _key setting that maps to a testcase column
        //    e.g., input "correct_answer" ← setting "correct_answer_key" → testcase column
        const keySettingName = `${key}_key`
        const keySettingValue = settings[keySettingName]

        if (typeof keySettingValue === "string" && keySettingValue) {
            const columnName = keySettingValue.startsWith("testcase.")
                ? keySettingValue.split(".")[1]
                : keySettingValue
            inputs[key] = normalizeCompact(testcaseData[columnName])
            continue
        }

        // 2. Known upstream output keys
        if (UPSTREAM_OUTPUT_KEYS.has(key)) {
            inputs[key] = key === "prediction" ? prediction : normalizeCompact(upstreamOutput)
            continue
        }

        // 3. Known testcase object keys — pass testcase data as a whole object
        //    e.g., auto_ai_critique expects "inputs" as the original workflow inputs
        if (TESTCASE_OBJECT_KEYS.has(key)) {
            inputs[key] = testcaseData
            continue
        }

        // 4. Direct testcase column match
        if (key in testcaseData) {
            inputs[key] = testcaseData[key]
            continue
        }
    }

    // 5. If schema allows additionalProperties, spread remaining testcase data
    if (inputSchema.additionalProperties !== false) {
        for (const [key, value] of Object.entries(testcaseData)) {
            if (!(key in inputs)) {
                inputs[key] = value
            }
        }
    }

    // Ensure upstream output is always present in some form
    if (!("prediction" in inputs) && !("outputs" in inputs)) {
        inputs.prediction = prediction
        inputs.outputs = upstreamOutput
    }

    console.debug("[buildEvaluatorExecutionInputs] schema-driven result", {
        keys: Object.keys(inputs),
        inputs,
    })

    return inputs
}

/**
 * Legacy input construction (no schema available).
 * Spreads testcase data + prediction + ground_truth from correct_answer_key.
 */
function buildLegacy(ctx: {
    testcaseData: Record<string, unknown>
    prediction: string
    settings: Record<string, unknown>
}): Record<string, unknown> {
    const {testcaseData, prediction, settings} = ctx

    const correctAnswerKey = settings.correct_answer_key
    const groundTruthKey =
        typeof correctAnswerKey === "string" && correctAnswerKey.startsWith("testcase.")
            ? correctAnswerKey.split(".")[1]
            : typeof correctAnswerKey === "string"
              ? correctAnswerKey
              : undefined

    const rawGT = groundTruthKey ? testcaseData[groundTruthKey] : undefined
    const ground_truth = normalizeCompact(rawGT)

    console.debug("[buildEvaluatorExecutionInputs] legacy fallback", {
        correct_answer_key: correctAnswerKey ?? "(not set)",
        groundTruthKey: groundTruthKey ?? "(none)",
        rawGT,
        ground_truth,
    })

    const inputs: Record<string, unknown> = {
        ...testcaseData,
        prediction,
    }

    if (groundTruthKey) {
        inputs.ground_truth = ground_truth
        inputs[groundTruthKey] = ground_truth
    }

    console.debug("[buildEvaluatorExecutionInputs] legacy result", {
        keys: Object.keys(inputs),
        inputs,
    })

    return inputs
}

/**
 * Result from validating evaluator inputs.
 */
export interface EvaluatorInputValidation {
    /** Whether all required inputs are available */
    valid: boolean
    /** List of missing required input keys */
    missingInputs: string[]
    /** Human-readable message explaining why the evaluator cannot run */
    message?: string
}

/**
 * Validate that all required evaluator inputs are available.
 *
 * Checks the evaluator's input schema for required fields and verifies that
 * the corresponding values can be resolved from testcase data or settings.
 *
 * This is used to skip evaluator execution when required inputs (like
 * `correct_answer` mapped via `correct_answer_key`) are missing from the testcase.
 *
 * @returns Validation result with `valid: true` if all required inputs are available,
 *          or `valid: false` with a list of missing inputs and an explanation message.
 */
export function validateEvaluatorInputs(ctx: EvaluatorInputContext): EvaluatorInputValidation {
    const {testcaseData, settings, inputSchema} = ctx

    const schemaProperties =
        inputSchema?.properties && typeof inputSchema.properties === "object"
            ? (inputSchema.properties as Record<string, unknown>)
            : null

    // Get required fields from schema (defaults to empty array if not specified)
    const requiredFields: string[] = Array.isArray(inputSchema?.required)
        ? (inputSchema.required as string[])
        : []

    if (!schemaProperties || requiredFields.length === 0) {
        // No schema or no required fields — validation passes
        return {valid: true, missingInputs: []}
    }

    const missingInputs: string[] = []

    for (const key of requiredFields) {
        // Skip upstream output keys — they come from the previous node, not testcase
        if (UPSTREAM_OUTPUT_KEYS.has(key)) {
            continue
        }

        // Skip testcase object keys — they're always available as the testcase itself
        if (TESTCASE_OBJECT_KEYS.has(key)) {
            continue
        }

        // Check for a corresponding _key setting that maps to a testcase column
        const keySettingName = `${key}_key`
        const keySettingValue = settings[keySettingName]

        if (typeof keySettingValue === "string" && keySettingValue) {
            // Setting exists — check if the mapped column exists in testcase data
            const columnName = keySettingValue.startsWith("testcase.")
                ? keySettingValue.split(".")[1]
                : keySettingValue
            const value = testcaseData[columnName]
            if (value === undefined || value === null || value === "") {
                missingInputs.push(key)
            }
            continue
        }

        // Check direct testcase column match
        if (key in testcaseData) {
            const value = testcaseData[key]
            if (value === undefined || value === null || value === "") {
                missingInputs.push(key)
            }
            continue
        }

        // Required field not found in settings or testcase data
        missingInputs.push(key)
    }

    if (missingInputs.length > 0) {
        const fieldList = missingInputs.map((f) => `"${f}"`).join(", ")
        return {
            valid: false,
            missingInputs,
            message: `Missing required input${missingInputs.length > 1 ? "s" : ""}: ${fieldList}. Check that the testcase contains the required data.`,
        }
    }

    return {valid: true, missingInputs: []}
}

/**
 * Normalize a value to a compact string representation.
 * Mirrors DebugSection's `normalizeCompact` helper.
 */
function normalizeCompact(val: unknown): string {
    if (val === undefined || val === null) return ""
    const str = typeof val === "string" ? val : JSON.stringify(val)
    try {
        const parsed = JSON.parse(str)
        if (parsed && typeof parsed === "object") {
            return JSON.stringify(parsed)
        }
        return str
    } catch {
        return str
    }
}

/**
 * Transform trace-prefixed keys in evaluator settings.
 * Strips `trace.` prefix from setting values (e.g. `"trace.spans.output"` → `"spans.output"`).
 * Mirrors DebugSection's `transformTraceKeysInSettings` from legacy evaluations.
 */
function transformTraceKeysInSettings(settings: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(settings)) {
        if (typeof value === "string" && value.startsWith("trace.")) {
            result[key] = value.replace("trace.", "")
        } else {
            result[key] = value
        }
    }
    return result
}

/**
 * Extract template variables from enhanced prompts (draft format).
 *
 * Enhanced prompts use a wrapped value structure:
 *   [{ messages: { value: [{ content: { value: "string" | ContentPart[] } }] } }]
 *
 * This is different from the raw agConfig format where content is a plain string.
 * Used to derive input ports from locally-edited prompts that haven't been saved yet.
 *
 * @param enhancedPrompts - Array of enhanced prompt objects
 * @returns Array of unique variable names
 */
export function extractVariablesFromEnhancedPrompts(
    enhancedPrompts: unknown[],
    templateFormat: TemplateFormat = "curly",
): string[] {
    if (!enhancedPrompts || enhancedPrompts.length === 0) return []

    const variables: string[] = []

    for (const prompt of enhancedPrompts) {
        const promptObj = prompt as Record<string, unknown> | null | undefined

        // Read template_format from the enhanced prompt if available
        const tfWrapper = (promptObj?.template_format ?? promptObj?.templateFormat) as
            | Record<string, unknown>
            | string
            | undefined
        const rawTf = typeof tfWrapper === "object" ? (tfWrapper?.value as string) : tfWrapper
        const effectiveFormat = resolveTemplateFormat(rawTf) ?? templateFormat

        const messagesWrapper = promptObj?.messages as Record<string, unknown> | undefined
        const messages = messagesWrapper?.value
        if (!Array.isArray(messages)) continue

        for (const message of messages) {
            const msgObj = message as Record<string, unknown> | null | undefined
            const contentWrapper = msgObj?.content as Record<string, unknown> | undefined
            const content = contentWrapper?.value
            if (typeof content === "string") {
                for (const v of extractTemplateVariables(content, effectiveFormat)) {
                    if (!variables.includes(v)) variables.push(v)
                }
            } else if (Array.isArray(content)) {
                for (const part of content) {
                    const partObj = part as Record<string, unknown> | null | undefined
                    const text =
                        typeof part === "string"
                            ? part
                            : ((partObj?.text as Record<string, unknown> | undefined)?.value ??
                              partObj?.text)
                    if (typeof text === "string") {
                        for (const v of extractTemplateVariables(text, effectiveFormat)) {
                            if (!variables.includes(v)) variables.push(v)
                        }
                    }
                }
            }
        }
    }

    return variables
}

// ============================================================================
// EXECUTION
// ============================================================================

export interface ExecuteRunnableOptions {
    inputs: Record<string, unknown>
    abortSignal?: AbortSignal
    /** Pre-built HTTP request body — bypasses default body construction when provided */
    rawBody?: Record<string, unknown>
    /** HTTP headers for the request (e.g., Authorization). Merged with defaults. */
    headers?: Record<string, string>
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
    type: RunnableType,
    data: RunnableData,
    options: ExecuteRunnableOptions,
): Promise<ExecutionResult> {
    const {inputs, abortSignal, rawBody, headers: optionHeaders} = options
    const executionId = crypto.randomUUID()
    const startedAt = new Date().toISOString()

    // Route built-in evaluator execution to the legacy evaluator run endpoint
    // when no invocation URL is available but a URI is present
    if (!data.invocationUrl && data.uri && parseEvaluatorKeyFromUri(data.uri)) {
        return executeEvaluator(data, options, executionId, startedAt)
    }

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
        // When rawBody is provided (e.g., from transformToRequestBody), use it directly.
        // Otherwise build the default { inputs, ag_config? } shape.
        const isTestEndpoint = data.invocationUrl.endsWith("/test")
        const requestBody: Record<string, unknown> =
            rawBody ??
            (() => {
                const body: Record<string, unknown> = {inputs}
                if (isTestEndpoint && data.configuration) {
                    body.ag_config = data.configuration
                }
                return body
            })()

        const response = await fetch(data.invocationUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(optionHeaders ?? {}),
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

        // Extract trace metadata from the top-level workflow response.
        const traceId = responseData?.trace_id
        const spanId = responseData?.span_id

        return {
            executionId,
            status: "success",
            startedAt,
            completedAt: new Date().toISOString(),
            output,
            // Store full response for detailed inspection
            structuredOutput: responseData,
            // Include trace info if available
            trace: traceId ? {id: traceId, ...(spanId ? {spanId} : {})} : undefined,
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

// ============================================================================
// EVALUATOR EXECUTION
// ============================================================================

/**
 * Execute a built-in evaluator via `POST /evaluators/{key}/run?project_id={projectId}`.
 *
 * Built-in evaluators don't have an `invocationUrl` — they are identified by
 * a URI (e.g., `"agenta:builtin:auto_exact_match:v0"`) and invoked through
 * the legacy evaluator run endpoint.
 *
 * Request body: `{ inputs: {...}, settings: {...} }`
 * Response body: `{ outputs: {...} }`
 */
async function executeEvaluator(
    data: RunnableData,
    options: ExecuteRunnableOptions,
    executionId: string,
    startedAt: string,
): Promise<ExecutionResult> {
    const {inputs, abortSignal, headers: optionHeaders} = options

    const evaluatorKey = parseEvaluatorKeyFromUri(data.uri ?? null)
    if (!evaluatorKey) {
        return {
            executionId,
            status: "error",
            startedAt,
            completedAt: new Date().toISOString(),
            error: {
                message: `Cannot parse evaluator key from URI: ${data.uri}`,
            },
        }
    }

    const store = getDefaultStore()
    const projectId = store.get(projectIdAtom)
    if (!projectId) {
        return {
            executionId,
            status: "error",
            startedAt,
            completedAt: new Date().toISOString(),
            error: {
                message: "No project ID available for evaluator execution",
            },
        }
    }

    const apiUrl = getAgentaApiUrl()
    const url = `${apiUrl}/evaluators/${evaluatorKey}/run?project_id=${projectId}`

    try {
        const rawSettings = (data.configuration ?? {}) as Record<string, unknown>
        const requestBody: Record<string, unknown> = {
            inputs,
            settings: transformTraceKeysInSettings(rawSettings),
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(optionHeaders ?? {}),
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        })

        if (!response.ok) {
            const errorText = await response.text()
            let errorMessage = `Evaluator request failed with status ${response.status}`

            try {
                const errorData = JSON.parse(errorText)
                if (errorData?.detail?.message) {
                    errorMessage = errorData.detail.message
                } else if (typeof errorData?.detail === "string") {
                    errorMessage = errorData.detail
                }
            } catch {
                if (errorText) {
                    errorMessage = errorText
                }
            }

            return {
                executionId,
                status: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                error: {message: errorMessage},
            }
        }

        const responseData = await response.json()

        // Evaluator run returns { outputs: {...} }
        const output = responseData?.outputs ?? responseData
        const traceId = responseData?.trace_id
        const spanId = responseData?.span_id

        return {
            executionId,
            status: "success",
            startedAt,
            completedAt: new Date().toISOString(),
            output,
            structuredOutput: responseData,
            trace: traceId ? {id: traceId, ...(spanId ? {spanId} : {})} : undefined,
        }
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return {
                executionId,
                status: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                error: {message: "Evaluator execution aborted"},
            }
        }

        return {
            executionId,
            status: "error",
            startedAt,
            completedAt: new Date().toISOString(),
            error: {
                message: error instanceof Error ? error.message : "Unknown evaluator error",
            },
        }
    }
}
