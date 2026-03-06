import {
    resolveChainInputs,
    computeTopologicalLevels,
    buildEvaluatorExecutionInputs,
    validateEvaluatorInputs,
    runnableBridge,
    type RunnableData,
    type ExecutionResult,
    type StageExecutionResult,
    type EntitySelection,
} from "@agenta/entities/runnable"
import type {Getter, Setter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import type {OutputConnection, PlaygroundNode} from "../types"

import {
    registerAbortController,
    cleanupAbortController,
    buildResultKey,
    resultsByKeyAtomFamily,
} from "./atoms"
import {createExecutionItemHandle} from "./executionItems"
import {extractTraceIdFromPayload} from "./trace"
import type {ExecutionSession, RunResult, SessionExecutionOptions} from "./types"

interface RunnableNode {
    id: string
    entity: EntitySelection
    depth: number
}

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

function createConcurrencyLimiter(concurrency: number) {
    let active = 0
    const queue: (() => void)[] = []

    return async <T>(fn: () => Promise<T>): Promise<T> => {
        if (active >= concurrency) {
            await new Promise<void>((resolve) => queue.push(resolve))
        }
        active++
        try {
            return await fn()
        } finally {
            active--
            queue.shift()?.()
        }
    }
}

interface ExecutionSessionLifecycleCallbacks {
    onStart: (payload: {runId: string}) => void
    onProgress: (payload: {
        chainProgress: RunResult["chainProgress"]
        chainResults?: RunResult["chainResults"]
    }) => void
    onComplete: (payload: {result: Partial<RunResult>}) => void
    onFail: (payload: {error: {message: string; code?: string}; traceId?: string | null}) => void
    onCancel: () => void
}

interface ExecuteStepForSessionParams {
    get: Getter
    set: Setter
    loadableId: string
    stepId: string
    session: ExecutionSession
    data: Record<string, unknown>
    nodes: PlaygroundNode[]
    allConnections: OutputConnection[]
    sessionOptions?: Record<string, SessionExecutionOptions>
    repetitionCount?: number
    lifecycle: ExecutionSessionLifecycleCallbacks
    /** When set, only execute this specific node instead of the full chain */
    targetNodeId?: string
    /** Cached chain results from a previous run (used to resolve inputs for targeted execution) */
    cachedChainResults?: Record<string, ExecutionResult>
}

export async function executeStepForSessionWithExecutionItems(
    params: ExecuteStepForSessionParams,
): Promise<void> {
    const {
        get,
        set: _set,
        loadableId,
        stepId,
        session,
        data,
        nodes,
        allConnections,
        sessionOptions,
        repetitionCount = 1,
        lifecycle,
    } = params

    const runnableNodes = nodes.map(toRunnableNode)
    const rootNode = runnableNodes.find((n) => n.depth === 0)
    if (!rootNode) {
        lifecycle.onFail({error: {message: "No root node (depth 0) found"}})
        return
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const perSession = sessionOptions?.[session.id]
    const projectId = perSession?.projectId
    const rootExecutionHandle = createExecutionItemHandle({
        loadableId,
        rowId: stepId,
        entityId: session.runnableId,
        runId,
    })

    const abortController = new AbortController()
    registerAbortController(runId, abortController)
    lifecycle.onStart({runId})

    try {
        const downstreamConnections = allConnections.filter((c) => c.sourceNodeId === rootNode.id)
        const isChain = downstreamConnections.length > 0
        const executionLevels = isChain
            ? computeTopologicalLevels(
                  runnableNodes.map((n) => ({nodeId: n.id})),
                  allConnections,
                  rootNode.id,
              )
            : [[rootNode.id]]

        // Pre-compute a flat index for each nodeId so stageIndex stays
        // backward-compatible with the old sequential numbering.
        const flatIndex = new Map<string, number>()
        let idx = 0
        for (const level of executionLevels) {
            for (const nid of level) {
                flatIndex.set(nid, idx++)
            }
        }

        const totalStages = idx || 1
        const chainResults: Record<string, StageExecutionResult> = {}
        const nodeResults: Record<string, ExecutionResult> = {}

        // Seed nodeResults with cached results from previous runs when doing targeted execution.
        // If cachedChainResults were explicitly provided, use them.
        // Otherwise, self-resolve from existing execution state (the root result's chainResults).
        if (params.targetNodeId) {
            let resolvedCache = params.cachedChainResults
            if (!resolvedCache) {
                const rootResultKey = buildResultKey(stepId, session.id)
                const allResults = get(resultsByKeyAtomFamily(loadableId))
                const prevRootResult = allResults[rootResultKey] as RunResult | undefined

                if (prevRootResult?.chainResults) {
                    resolvedCache = {}
                    for (const [nid, stage] of Object.entries(prevRootResult.chainResults)) {
                        resolvedCache[nid] = {
                            executionId: stage.executionId,
                            status: stage.status as "success" | "error",
                            startedAt: stage.startedAt,
                            completedAt: stage.completedAt,
                            output: stage.output,
                            structuredOutput: stage.structuredOutput,
                            error: stage.error,
                            trace: stage.traceId ? {id: stage.traceId} : undefined,
                            metrics: stage.metrics,
                        }
                    }
                }
            }
            if (resolvedCache) {
                for (const [nid, res] of Object.entries(resolvedCache)) {
                    nodeResults[nid] = res
                }
            }
        }

        // Execute nodes level-by-level. Nodes within the same level have all
        // their upstream dependencies satisfied and can run in parallel.
        for (const level of executionLevels) {
            if (abortController.signal.aborted) {
                lifecycle.onCancel()
                return
            }

            await Promise.all(
                level.map(async (nodeId) => {
                    const stageIndex = flatIndex.get(nodeId) ?? 0
                    const node = runnableNodes.find((n) => n.id === nodeId)
                    if (!node) return

                    // When targeting a specific node, skip non-target stages.
                    // Populate chainResults from cached data if available.
                    if (params.targetNodeId && nodeId !== params.targetNodeId) {
                        if (nodeResults[nodeId]) {
                            const cachedResult = nodeResults[nodeId]
                            const nodeLabel = node.entity.label || `Stage ${stageIndex + 1}`
                            chainResults[nodeId] = {
                                executionId: cachedResult.executionId,
                                nodeId,
                                nodeLabel,
                                nodeType: node.entity.type,
                                stageIndex,
                                status: cachedResult.status,
                                startedAt: cachedResult.startedAt,
                                completedAt: cachedResult.completedAt,
                                output: cachedResult.output,
                                structuredOutput: cachedResult.structuredOutput,
                                error: cachedResult.error,
                                traceId: cachedResult.trace?.id || null,
                                metrics: cachedResult.metrics,
                            }
                        }
                        return
                    }

                    const nodeLabel = node.entity.label || `Stage ${stageIndex + 1}`

                    lifecycle.onProgress({
                        chainProgress: {
                            currentStage: stageIndex + 1,
                            totalStages,
                            currentNodeId: nodeId,
                            currentNodeLabel: nodeLabel,
                            currentNodeType: node.entity.type,
                        },
                        chainResults,
                    })

                    let nodeInputs: Record<string, unknown>
                    if (node.depth === 0) {
                        nodeInputs = {...data}
                    } else {
                        // Check whether the incoming connection has explicit valid mappings.
                        // resolveChainInputs always returns non-empty (fallback spreads testcaseData
                        // + prediction), so we can't rely on its result length alone.
                        const incomingConnection = allConnections.find(
                            (c) => c.targetNodeId === nodeId,
                        )
                        const hasExplicitMappings =
                            incomingConnection?.inputMappings?.some(
                                (m) => m.status === "valid" && m.sourcePath,
                            ) ?? false

                        if (hasExplicitMappings) {
                            // Use resolveChainInputs with explicit inputMappings
                            const resolved = resolveChainInputs(
                                allConnections,
                                nodeId,
                                nodeResults,
                                data,
                            )
                            console.debug(
                                `[executionRunner] Node "${nodeLabel}" (${nodeId}): using resolveChainInputs (explicit mappings)`,
                                {resolvedKeys: Object.keys(resolved), resolved},
                            )
                            nodeInputs = resolved
                        } else {
                            // No explicit mappings — delegate to entity-owned input construction
                            // (DebugSection pattern). This handles evaluator-specific logic like
                            // correct_answer_key → ground_truth resolution.
                            const upstreamNodeId = incomingConnection?.sourceNodeId
                            const upstreamResult = upstreamNodeId
                                ? nodeResults[upstreamNodeId]
                                : undefined
                            const upstreamOutput =
                                upstreamResult?.output ?? upstreamResult?.structuredOutput

                            const evalStore = getDefaultStore()
                            const typeScopedData = runnableBridge.forType(node.entity.type)
                            const stageRunnableData = evalStore.get(
                                typeScopedData.data(node.entity.id as string),
                            ) as RunnableData | null

                            // Extract inputSchema from the bridge's RunnableData.
                            // The bridge returns { schemas: { inputSchema, outputSchema } }.
                            const bridgeSchemas = (
                                stageRunnableData as Record<string, unknown> | null
                            )?.schemas as {inputSchema?: Record<string, unknown>} | undefined
                            const inputSchema = bridgeSchemas?.inputSchema ?? null

                            const evaluatorInputContext = {
                                testcaseData: data,
                                upstreamOutput,
                                settings: stageRunnableData?.configuration ?? {},
                                inputSchema,
                            }

                            // Validate required inputs before building — skip if missing
                            const validation = validateEvaluatorInputs(evaluatorInputContext)
                            if (!validation.valid) {
                                console.debug(
                                    `[executionRunner] Node "${nodeLabel}" (${nodeId}): skipping due to missing required inputs`,
                                    {
                                        missingInputs: validation.missingInputs,
                                        message: validation.message,
                                    },
                                )

                                // Record skipped result and return (parallel-safe)
                                const skippedAt = new Date().toISOString()
                                chainResults[nodeId] = {
                                    executionId: `skipped-${nodeId}-${Date.now()}`,
                                    nodeId,
                                    nodeLabel,
                                    nodeType: node.entity.type,
                                    stageIndex,
                                    status: "skipped",
                                    startedAt: skippedAt,
                                    completedAt: skippedAt,
                                    error: {
                                        message:
                                            validation.message ||
                                            `Missing required inputs: ${validation.missingInputs.join(", ")}`,
                                        code: "MISSING_REQUIRED_INPUTS",
                                    },
                                    traceId: null,
                                }
                                return
                            }

                            console.debug(
                                `[executionRunner] Node "${nodeLabel}" (${nodeId}): no explicit mappings, using buildEvaluatorExecutionInputs`,
                                {
                                    testcaseDataKeys: Object.keys(data),
                                    testcaseData: data,
                                    upstreamOutput,
                                    settings: stageRunnableData?.configuration ?? {},
                                    hasInputSchema: !!inputSchema,
                                    inputSchemaProperties: inputSchema?.properties
                                        ? Object.keys(
                                              inputSchema.properties as Record<string, unknown>,
                                          )
                                        : [],
                                },
                            )

                            nodeInputs = buildEvaluatorExecutionInputs(evaluatorInputContext)
                        }

                        console.debug(
                            `[executionRunner] Node "${nodeLabel}" (${nodeId}): final nodeInputs`,
                            {keys: Object.keys(nodeInputs), nodeInputs},
                        )
                    }

                    const stageRunnableId =
                        node.depth === 0 ? session.runnableId : (node.entity.id as string)
                    const stageHandle =
                        node.depth === 0
                            ? rootExecutionHandle
                            : createExecutionItemHandle({
                                  loadableId,
                                  rowId: stepId,
                                  entityId: stageRunnableId,
                                  entityType: node.entity.type,
                              })

                    const stageExecutionItem = stageHandle.run({
                        get,
                        headers: perSession?.headers ?? {},
                        repetitions: 1,
                        runId,
                        inputValues: nodeInputs,
                        projectId,
                    })
                    if (!stageExecutionItem) {
                        throw new Error(`Failed to build execution item for ${stageRunnableId}`)
                    }

                    if (node.depth > 0) {
                        console.debug(
                            `[executionRunner] Node "${nodeLabel}" (${nodeId}): final request`,
                            {
                                invocationUrl: stageExecutionItem.invocation.invocationUrl,
                                requestBodyKeys: Object.keys(
                                    stageExecutionItem.invocation.requestBody,
                                ),
                                requestBody: stageExecutionItem.invocation.requestBody,
                            },
                        )
                    }

                    // Use the execution item's invocationUrl and requestBody directly.
                    // This is the same URL the web worker uses (includes /test suffix),
                    // ensuring a single unified URL resolution path for all execution modes.
                    const result = await executeViaFetch({
                        invocationUrl: stageExecutionItem.invocation.invocationUrl,
                        requestBody: stageExecutionItem.invocation.requestBody,
                        headers: {
                            ...stageExecutionItem.invocation.headers,
                            ...(perSession?.headers ?? {}),
                        },
                        abortSignal: abortController.signal,
                        normalizeResponse: (responseData) =>
                            runnableBridge.normalizeResponse(stageRunnableId, responseData),
                    })

                    if (!result) {
                        throw new Error(`Execution returned null for node ${nodeId}`)
                    }

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
                    // Downstream node errors are recorded in chainResults but don't stop siblings.
                }),
            )

            // Root node failure is fatal — downstream nodes depend on its output.
            // The root is always alone in its level, so check after level completes.
            if (level.includes(rootNode.id) && nodeResults[rootNode.id]?.status === "error") {
                lifecycle.onFail({
                    error: nodeResults[rootNode.id].error || {message: "Execution failed"},
                    traceId: nodeResults[rootNode.id].trace?.id ?? null,
                })
                return
            }
        }

        const primaryResult = nodeResults[rootNode.id]
        const repetitions: {
            output?: unknown
            structuredOutput?: unknown
            metrics?: typeof primaryResult.metrics
            traceId?: string | null
            chainResults?: Record<string, StageExecutionResult>
        }[] = []

        if (repetitionCount > 1) {
            repetitions.push({
                output: primaryResult?.output,
                structuredOutput: primaryResult?.structuredOutput,
                metrics: primaryResult?.metrics,
                traceId: primaryResult?.trace?.id || null,
                chainResults: {...chainResults},
            })

            for (let rep = 1; rep < repetitionCount; rep++) {
                if (abortController.signal.aborted) break

                const perSession2 = sessionOptions?.[session.id]
                const nodeInputs2 = {...data}
                const repetitionItem = rootExecutionHandle.retry({
                    get,
                    headers: perSession2?.headers ?? {},
                    repetitions: 1,
                    inputValues: nodeInputs2,
                    projectId: perSession2?.projectId ?? projectId,
                })
                if (!repetitionItem) break

                try {
                    const repResult = await executeViaFetch({
                        invocationUrl: repetitionItem.invocation.invocationUrl,
                        requestBody: repetitionItem.invocation.requestBody,
                        headers: {
                            ...repetitionItem.invocation.headers,
                            ...(perSession2?.headers ?? {}),
                        },
                        abortSignal: abortController.signal,
                    })

                    repetitions.push({
                        output: repResult?.output,
                        structuredOutput: repResult?.structuredOutput,
                        metrics: repResult?.metrics,
                        traceId: repResult?.trace?.id || null,
                    })
                } catch {
                    break
                }
            }
        }

        lifecycle.onComplete({
            result: {
                runId,
                output: primaryResult?.output,
                structuredOutput: primaryResult?.structuredOutput,
                metrics: primaryResult?.metrics,
                traceId: primaryResult?.trace?.id || null,
                isChain,
                totalStages,
                chainResults,
                ...(repetitions.length > 1 ? {repetitions} : {}),
            },
        })
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            lifecycle.onCancel()
        } else {
            lifecycle.onFail({
                error: {message: error instanceof Error ? error.message : String(error)},
            })
        }
    } finally {
        cleanupAbortController(runId)
    }
}

// ============================================================================
// UNIFIED FETCH EXECUTION
// ============================================================================

/**
 * Execute a request using the execution item's pre-resolved URL and body.
 *
 * This is the unified execution path for both single-node and chain execution.
 * The execution item already resolves the correct invocation URL (including /test
 * suffix) and builds the correct request body — this function simply performs
 * the fetch, matching what the web worker does.
 */
async function executeViaFetch(params: {
    invocationUrl: string
    requestBody: Record<string, unknown>
    headers: Record<string, string>
    abortSignal?: AbortSignal
    normalizeResponse?: (responseData: unknown) => {output: unknown; trace?: {id: string}}
}): Promise<ExecutionResult> {
    const {invocationUrl, requestBody, headers, abortSignal, normalizeResponse} = params
    const executionId = crypto.randomUUID()
    const startedAt = new Date().toISOString()

    try {
        const response = await fetch(invocationUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        })

        if (!response.ok) {
            const errorText = await response.text()
            let errorMessage = `Request failed with status ${response.status}`
            let traceId: string | null = null

            try {
                const errorData = JSON.parse(errorText)
                traceId = extractTraceIdFromPayload(errorData)
                if (errorData?.status?.message) {
                    errorMessage = errorData.status.message
                } else if (errorData?.detail?.message) {
                    errorMessage = errorData.detail.message
                } else if (typeof errorData?.detail === "string") {
                    errorMessage = errorData.detail
                }
            } catch {
                if (errorText) errorMessage = errorText
            }

            return {
                executionId,
                status: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                error: {message: errorMessage},
                ...(traceId ? {trace: {id: traceId}} : {}),
            }
        }

        const responseData = await response.json()

        // Delegate response parsing to entity-level normalizer when provided.
        // Default: unwrap `data` field if present, extract `trace_id`.
        const normalized = normalizeResponse
            ? normalizeResponse(responseData)
            : {
                  output: responseData?.data !== undefined ? responseData.data : responseData,
                  trace: responseData?.trace_id ? {id: responseData.trace_id as string} : undefined,
              }

        return {
            executionId,
            status: "success",
            startedAt,
            completedAt: new Date().toISOString(),
            output: normalized.output,
            structuredOutput: responseData,
            trace: normalized.trace,
        }
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return {
                executionId,
                status: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                error: {message: "Execution aborted"},
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
// MULTI-SESSION RUNNER
// ============================================================================

interface RunSessionsWithExecutionItemsParams {
    get: Getter
    set: Setter
    loadableId: string
    stepId: string
    sessions: ExecutionSession[]
    data: Record<string, unknown>
    nodes: PlaygroundNode[]
    allConnections: OutputConnection[]
    sessionOptions?: Record<string, SessionExecutionOptions>
    repetitionCount?: number
    concurrency: number
    createLifecycle: (session: ExecutionSession) => ExecutionSessionLifecycleCallbacks
    /** When set, only execute this specific node instead of the full chain */
    targetNodeId?: string
    /** Cached chain results from a previous run (used to resolve inputs for targeted execution) */
    cachedChainResults?: Record<string, ExecutionResult>
}

export async function runSessionsWithExecutionItems(
    params: RunSessionsWithExecutionItemsParams,
): Promise<void> {
    const {
        get,
        set,
        loadableId,
        stepId,
        sessions,
        data,
        nodes,
        allConnections,
        sessionOptions,
        repetitionCount = 1,
        concurrency,
        createLifecycle,
    } = params

    const limit = createConcurrencyLimiter(concurrency)
    await Promise.all(
        sessions.map((session) =>
            limit(() =>
                executeStepForSessionWithExecutionItems({
                    get,
                    set,
                    loadableId,
                    stepId,
                    session,
                    data,
                    nodes,
                    allConnections,
                    sessionOptions,
                    repetitionCount,
                    lifecycle: createLifecycle(session),
                    targetNodeId: params.targetNodeId,
                    cachedChainResults: params.cachedChainResults,
                }),
            ),
        ),
    )
}
