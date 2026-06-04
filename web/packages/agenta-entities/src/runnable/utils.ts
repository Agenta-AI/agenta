/**
 * Runnable Utilities
 *
 * Chain execution and input mapping utilities for runnables.
 */

import {getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getValueAtPath, generateId, parseMustache, walkMustache} from "@agenta/shared/utils"
import {getDefaultStore} from "jotai/vanilla"

import {parseEvaluatorKeyFromUri} from "../workflow/core"

import {groupTemplateVariables} from "./portHelpers"
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

type TemplateFormat = "mustache" | "curly" | "fstring" | "jinja2"

/** Normalize a raw template_format string to a known TemplateFormat, or null if unrecognized. */
export function resolveTemplateFormat(raw: string | null | undefined): TemplateFormat | null {
    if (raw === "fstring") return "fstring"
    if (raw === "jinja2" || raw === "jinja") return "jinja2"
    if (raw === "curly") return "curly"
    if (raw === "mustache") return "mustache"
    return null
}

/**
 * Extract variables from a template string.
 *
 * Supports multiple template formats:
 * - "curly" (default): {{variableName}}
 * - "mustache": {{variableName}} (shares the {{...}} extraction path with curly)
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

    // curly, jinja2, and mustache all use {{variableName}} for variable substitution
    // Linear scan: find '{{', then find '}}', extract the content between them.
    //
    // For MUSTACHE, normalise / skip block-level syntax AND track section depth:
    //
    //   keep (strip prefix → variable name) WHEN AT TOP LEVEL (depth 0):
    //     - `{{#name}}` — section opener: `name` IS a variable (the iterable
    //                      / truthiness check). Increments section depth.
    //     - `{{^name}}` — inverted section opener: same — `name` is a variable.
    //                      Increments section depth.
    //     - `{{&name}}` — unescaped variable: `name` IS the variable.
    //     - bare `{{name}}` — plain variable reference.
    //
    //   structural / inert tokens (no variable emitted regardless of depth):
    //     - `{{/name}}`      — section closer. Decrements section depth.
    //     - `{{!comment}}`   — comment.
    //     - `{{> partial}}`  — partial template inclusion (resolved at render).
    //     - `{{.}}`          — implicit iterator (current item, no base name).
    //
    //   **inside a section (depth > 0): variable extraction is suppressed.**
    //   `{{#repo}}{{name}}{{/repo}}` emits `['repo']`, NOT `['repo', 'name']`.
    //   Mahmoud's QA on 2026-06-02: "since `name` is in that loop, it's
    //   actually `repo.name`". We don't yet model scoped names, so we skip
    //   the bare reference rather than register a phantom top-level port.
    //   Section openers nested inside another section are ALSO skipped for
    //   the same reason. The user fills the top-level section variable
    //   (`repo`) with raw JSON (array of objects, single object, or scalar
    //   per their template's intent); the runtime resolves the inner names
    //   at render time. Full scope-aware discovery is Phase 2 — see
    //   `docs/designs/mustache-section-support.md`.
    //
    // For CURLY / JINJA2, none of those prefix characters are valid in
    // identifiers — those formats have no section semantics, no implicit
    // iterator, no inline comments / partials inside `{{...}}`. If the user
    // wrote `{{#items}}` in a curly prompt it's an authoring error (likely
    // mustache syntax pasted in). Skip the extraction so no phantom port
    // appears in the playground — the user sees the broken token in the
    // editor without the FE silently masking it.
    //
    // The TokenPlugin highlights all of these via its own regex — this filter
    // is for PORT DISCOVERY only. The mustache renderer pairs `#`/`^`/`/`
    // structurally at render time.
    // Mustache: defer to the structural parser
    // (`@agenta/shared/utils/mustache#parseMustache`) and emit scope-aware
    // variable PATHS. Phase 2 of `docs/designs/mustache-section-support.md`.
    //
    //   `{{#repo}}{{name}}{{/repo}}`        → ['repo', 'repo.name']
    //   `{{#org}}{{#users}}{{name}}{{/users}}{{/org}}`
    //                                       → ['org', 'org.users', 'org.users.name']
    //   `{{name}}{{#sec}}{{a}}{{/sec}}{{country.a}}`
    //                                       → ['name', 'sec', 'sec.a', 'country.a']
    //
    // Section openers contribute their name (the user must provide a value
    // for the section to render). Variables inside a section join the
    // open-stack with `.` separators.
    //
    //   `{{.}}` — implicit iterator, never emits.
    //   `{{&body}}` joins the stack like a plain variable.
    //   Structural-only tags (comments, partials, set-delimiter,
    //   inheritance blocks `{{$x}}`, parent templates `{{<x}}`) NEVER emit.
    //   Mustache inheritance is recognised by the parser so the FE doesn't
    //   surface phantom variable names like `$slot`.
    //
    // Duplicates dedupe in source order (first occurrence wins).
    if (templateFormat === "mustache") {
        const {ast} = parseMustache(input)
        const seen = new Set<string>()
        const pathStack: string[] = []
        const join = (name: string): string =>
            pathStack.length === 0 ? name : `${pathStack.join(".")}.${name}`
        const emit = (name: string) => {
            if (!name) return
            if (seen.has(name)) return
            seen.add(name)
            variables.push(name)
        }
        walkMustache(ast, {
            onEnter: (node) => {
                if (node.kind === "section") {
                    // Empty section names — produced while the user is
                    // mid-typing `{{#|}}` (autoclose state, no name yet) —
                    // contribute nothing to paths AND must not push the
                    // empty string onto the stack. Otherwise inner
                    // variables would join as `".name"` (leading dot).
                    if (!node.name) return
                    emit(join(node.name))
                    pathStack.push(node.name)
                } else if (node.kind === "variable") {
                    if (node.implicitIterator) return
                    emit(join(node.name))
                }
                // text / comment / partial / delimiter / block / parent
                // contribute no variables.
            },
            onExit: (node) => {
                // Symmetric to onEnter — only pop when the corresponding
                // push happened. The parser's walk is depth-paired so
                // this keeps stack alignment safe.
                if (node.kind === "section" && node.name) pathStack.pop()
            },
        })
        return variables
    }

    // curly / jinja2: linear scan for `{{name}}`. Anything starting with
    // mustache-style markers is an authoring error in these formats; skip
    // so the playground doesn't surface a port for the bad token.
    let i = 0
    while (i < input.length - 1) {
        if (input[i] === "{" && input[i + 1] === "{") {
            const start = i + 2
            const end = input.indexOf("}}", start)
            if (end !== -1) {
                const raw = input.slice(start, end).trim()
                // Authoring-error guard: include `$<` and `=` so spec-mustache
                // inheritance tags pasted into a curly/jinja2 prompt don't
                // surface as phantom ports.
                const startsWithMustacheMarker = /^[#^&/!>.$<=]/.test(raw)
                if (raw && !startsWithMustacheMarker && !variables.includes(raw)) {
                    variables.push(raw)
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
 * Extract section opener PATHS from a mustache template string.
 *
 * Walks the AST and emits a dotted path for every section opener
 * (`{{#name}}` or `{{^name}}`) — joined with `.` against the path
 * stack of enclosing sections. So for
 *
 *   `{{#repos}}{{#contributors}}{{name}}{{/contributors}}{{/repos}}`
 *
 * the returned set is `{"repos", "repos.contributors"}`.
 *
 * Callers (`groupTemplateVariables` via `portHelpers.ts`, and the schema
 * producer in `molecule.ts` via `buildSubPathSchema`) use this hint to:
 *   - infer the GROUP'S type as `array` when its top-level name is a
 *     section opener (`repos` here),
 *   - emit nested array-of-objects schemas when a SUB-PATH is itself a
 *     section opener (`repos.contributors` here).
 *
 * Distinct from `extractTemplateVariables`, which returns every referenced
 * placeholder (variables, section openers, dotted access). Always returns
 * an empty set for non-mustache formats: curly / jinja2 / fstring don't
 * have section semantics, so the hint isn't meaningful there.
 */
export function extractMustacheSectionOpeners(
    input: string,
    templateFormat: TemplateFormat = "curly",
): Set<string> {
    const paths = new Set<string>()
    if (templateFormat !== "mustache") return paths

    const {ast} = parseMustache(input)
    const stack: string[] = []
    walkMustache(ast, {
        onEnter: (node) => {
            if (node.kind === "section") {
                // Skip empty section names (mid-typing autoclose state)
                // — they'd contribute a leading-dot path otherwise.
                if (!node.name) return
                const path = stack.length === 0 ? node.name : `${stack.join(".")}.${node.name}`
                paths.add(path)
                stack.push(node.name)
            }
        },
        onExit: (node) => {
            if (node.kind === "section" && node.name) stack.pop()
        },
    })
    return paths
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
 * Mirror of `extractVariablesFromConfig` that collects mustache SECTION
 * OPENERS (`{{#name}}` / `{{^name}}`) across all prompt-like entries in
 * config. Used alongside `extractVariablesFromConfig` to feed the
 * `sectionOpeners` hint into `groupTemplateVariables`, so a name referenced
 * only via section markers (no sub-paths) surfaces as an `array` port
 * instead of the default `string` port.
 *
 * Always returns an empty set for non-mustache prompts — section semantics
 * are mustache-specific.
 */
export function extractSectionOpenersFromConfig(
    agConfig: Record<string, unknown> | undefined,
): Set<string> {
    const openers = new Set<string>()
    if (!agConfig) return openers

    for (const value of Object.values(agConfig)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        const prompt = value as Record<string, unknown>

        const rawTf = (prompt.template_format ?? prompt.templateFormat) as string | undefined
        const tf = resolveTemplateFormat(rawTf) ?? "curly"
        if (tf !== "mustache") continue

        if (!Array.isArray(prompt.messages)) continue
        for (const message of prompt.messages) {
            if (!message || typeof message !== "object") continue
            const content = (message as Record<string, unknown>).content
            if (typeof content === "string") {
                for (const opener of extractMustacheSectionOpeners(content, tf)) {
                    openers.add(opener)
                }
            } else if (Array.isArray(content)) {
                for (const part of content) {
                    if (typeof part === "string") {
                        for (const opener of extractMustacheSectionOpeners(part, tf)) {
                            openers.add(opener)
                        }
                    } else if (part && typeof part === "object") {
                        const text = (part as Record<string, unknown>).text
                        if (typeof text === "string") {
                            for (const opener of extractMustacheSectionOpeners(text, tf)) {
                                openers.add(opener)
                            }
                        }
                    }
                }
            }
        }
    }
    return openers
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

/**
 * Compute the `input_keys` for a single prompt config.
 *
 * `input_keys` must be the set of TOP-LEVEL keys that the runtime `inputs`
 * dict is keyed by — NOT the raw scoped/dotted placeholder paths. For
 * mustache/jinja2 a reference like `{{country.name}}` resolves `name`
 * against the top-level `country` object, so the input key is `country`;
 * a section `{{#repos}}{{name}}{{/repos}}` has input key `repos`. For
 * curly, dotted names are LITERAL testcase columns (backend literal-key
 * resolver), so `{{user.name}}` stays `user.name`.
 *
 * `groupTemplateVariables` already encodes exactly this format-aware
 * collapse (via `parseTemplateExpression`), and is the same helper the
 * input-port discovery (`inputPortsAtomFamily`) and the invoke request
 * builder use. Routing `input_keys` through it keeps the SAVED config in
 * sync with what the backend validates at invoke time.
 *
 * Background: previously this used the raw `extractVariablesFromConfig`
 * output, which for mustache returns scoped dotted paths (`country.name`,
 * `repos.name`). The saved `input_keys` then mismatched the actual inputs
 * dict keys, and every deployed invoke failed with
 * `Invalid inputs: Expected [...] Got [...]` (Mahmoud QA 2026-06-03).
 */
function computePromptInputKeys(
    promptKey: string,
    promptConfig: Record<string, unknown>,
): string[] {
    const vars = extractVariablesFromConfig({[promptKey]: promptConfig})
    if (vars.length === 0) return []

    const sectionOpeners = extractSectionOpenersFromConfig({[promptKey]: promptConfig})
    const rawTf = (promptConfig.template_format ?? promptConfig.templateFormat) as
        | string
        | undefined
    const templateFormat = resolveTemplateFormat(rawTf) ?? undefined

    const grouped = groupTemplateVariables(vars, {sectionOpeners, templateFormat})

    // Only `inputs`-envelope keys become testcase columns / input keys.
    // Other envelopes (`$.outputs.*`, `$.parameters.*`, ...) are runtime-
    // resolved and must not appear in `input_keys`. Dedup in first-seen
    // order (groupTemplateVariables already dedups by envelope.key, but
    // guard defensively).
    const seen = new Set<string>()
    const keys: string[] = []
    for (const group of grouped) {
        if (group.envelope !== "inputs") continue
        if (seen.has(group.key)) continue
        seen.add(group.key)
        keys.push(group.key)
    }
    return keys
}

function syncPromptInputKeysInConfig(config: Record<string, unknown>): Record<string, unknown> {
    let changed = false
    const result = {...config}

    for (const [key, value] of Object.entries(result)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue

        const promptConfig = value as Record<string, unknown>
        if (!Array.isArray(promptConfig.messages)) continue

        const variables = computePromptInputKeys(key, promptConfig)
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

function unwrapEvaluatorTestcaseData(
    testcaseData: Record<string, unknown>,
): Record<string, unknown> {
    const nestedInputs = testcaseData.inputs
    if (
        nestedInputs &&
        typeof nestedInputs === "object" &&
        !Array.isArray(nestedInputs) &&
        ("outputs" in testcaseData || "prediction" in testcaseData)
    ) {
        return nestedInputs as Record<string, unknown>
    }

    return testcaseData
}

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
    const {upstreamOutput, settings, inputSchema} = ctx
    const testcaseData = unwrapEvaluatorTestcaseData(ctx.testcaseData)

    // RFC invariant: native JSON stays native until template rendering.
    // We pass `upstreamOutput` through as-is (object, array, string, primitive)
    // and expose it under both `prediction` and `outputs` keys downstream —
    // they are the same value, not a stringified copy and a native copy.

    const schemaProperties =
        inputSchema?.properties && typeof inputSchema.properties === "object"
            ? (inputSchema.properties as Record<string, unknown>)
            : null

    if (schemaProperties) {
        return buildFromSchema({
            schemaProperties,
            inputSchema: inputSchema!,
            testcaseData,
            upstreamOutput,
            settings,
        })
    }

    // Legacy fallback — no schema available
    return buildLegacy({testcaseData, upstreamOutput, settings})
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
    settings: Record<string, unknown>
}): Record<string, unknown> {
    const {schemaProperties, inputSchema, testcaseData, upstreamOutput, settings} = ctx
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
            // RFC invariant: native value passes through, not stringified.
            inputs[key] = testcaseData[columnName]
            continue
        }

        // 2. Known upstream output keys — both `prediction` and `outputs`
        //    expose the SAME native upstream value; do not stringify either one.
        if (UPSTREAM_OUTPUT_KEYS.has(key)) {
            inputs[key] = upstreamOutput
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

    // Ensure upstream output is always present in some form (native, both keys).
    if (!("prediction" in inputs) && !("outputs" in inputs)) {
        inputs.prediction = upstreamOutput
        inputs.outputs = upstreamOutput
    }

    return inputs
}

/**
 * Legacy input construction (no schema available).
 * Spreads testcase data + prediction + ground_truth from correct_answer_key.
 */
function buildLegacy(ctx: {
    testcaseData: Record<string, unknown>
    upstreamOutput: unknown
    settings: Record<string, unknown>
}): Record<string, unknown> {
    const {testcaseData, upstreamOutput, settings} = ctx

    const correctAnswerKey = settings.correct_answer_key
    const groundTruthKey =
        typeof correctAnswerKey === "string" && correctAnswerKey.startsWith("testcase.")
            ? correctAnswerKey.split(".")[1]
            : typeof correctAnswerKey === "string"
              ? correctAnswerKey
              : undefined

    // RFC invariant: native ground-truth value passes through, not stringified.
    const ground_truth = groundTruthKey ? testcaseData[groundTruthKey] : undefined

    const inputs: Record<string, unknown> = {
        ...testcaseData,
        prediction: upstreamOutput,
    }

    if (groundTruthKey) {
        inputs.ground_truth = ground_truth
        inputs[groundTruthKey] = ground_truth
    }

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
    const {settings, inputSchema} = ctx
    const testcaseData = unwrapEvaluatorTestcaseData(ctx.testcaseData)

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
    const executionId = generateId()
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
