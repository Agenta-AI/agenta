import {
    resolveChainInputs,
    computeTopologicalOrder,
    buildEvaluatorExecutionInputs,
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
    onFail: (payload: {error: {message: string; code?: string}}) => void
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
        const executionOrder = isChain
            ? computeTopologicalOrder(
                  runnableNodes.map((n) => ({nodeId: n.id})),
                  allConnections,
                  rootNode.id,
              )
            : [rootNode.id]
        const stageOrder = executionOrder

        const totalStages = stageOrder?.length || 1
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

                console.log("[chain:targeted] Cache resolution:", {
                    targetNodeId: params.targetNodeId,
                    rootResultKey,
                    hasRootResult: !!prevRootResult,
                    rootStatus: prevRootResult?.status,
                    hasChainResults: !!prevRootResult?.chainResults,
                    chainResultKeys: prevRootResult?.chainResults
                        ? Object.keys(prevRootResult.chainResults)
                        : [],
                })

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
                console.log("[chain:targeted] Seeded nodeResults:", {
                    nodeIds: Object.keys(nodeResults),
                    statuses: Object.fromEntries(
                        Object.entries(nodeResults).map(([k, v]) => [k, v.status]),
                    ),
                    hasOutput: Object.fromEntries(
                        Object.entries(nodeResults).map(([k, v]) => [k, !!v.output]),
                    ),
                })
            } else {
                console.warn("[chain:targeted] No cached results found for targeted execution")
            }
        }

        for (let stageIndex = 0; stageIndex < (stageOrder?.length || 1); stageIndex++) {
            if (abortController.signal.aborted) {
                lifecycle.onCancel()
                return
            }

            const nodeId = stageOrder?.[stageIndex] || rootNode.id
            const node = runnableNodes.find((n) => n.id === nodeId)
            if (!node) continue

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
                continue
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
                console.log("[chain] Root node inputs (testcase data):", nodeInputs)
            } else {
                // Try resolveChainInputs first (uses inputMappings from connection config)
                const resolved = resolveChainInputs(allConnections, nodeId, nodeResults, data)

                console.log("[chain] resolveChainInputs for node", nodeId, {
                    resolvedKeys: Object.keys(resolved),
                    resolved,
                    nodeResultKeys: Object.keys(nodeResults),
                })

                if (Object.keys(resolved).length > 0) {
                    nodeInputs = resolved
                    console.log("[chain] Using resolveChainInputs result:", nodeInputs)
                } else {
                    // Fallback: inputMappings is empty (default for new connections).
                    // Delegate to entity-owned input construction (DebugSection pattern).
                    const upstreamNodeId = allConnections.find(
                        (c) => c.targetNodeId === nodeId,
                    )?.sourceNodeId
                    const upstreamResult = upstreamNodeId ? nodeResults[upstreamNodeId] : undefined
                    const upstreamOutput =
                        upstreamResult?.output ?? upstreamResult?.structuredOutput

                    const evalStore = getDefaultStore()
                    const typeScopedData = runnableBridge.forType(node.entity.type)
                    const stageRunnableData = evalStore.get(
                        typeScopedData.data(node.entity.id as string),
                    ) as RunnableData | null

                    console.log("[chain] Fallback: buildEvaluatorExecutionInputs context:", {
                        testcaseData: data,
                        upstreamNodeId,
                        upstreamOutput,
                        hasUpstreamResult: !!upstreamResult,
                        settingsKeys: Object.keys(stageRunnableData?.configuration ?? {}),
                        configuration: stageRunnableData?.configuration,
                    })

                    nodeInputs = buildEvaluatorExecutionInputs({
                        testcaseData: data,
                        upstreamOutput,
                        settings: stageRunnableData?.configuration ?? {},
                    })
                    console.log("[chain] buildEvaluatorExecutionInputs result:", nodeInputs)
                }
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

            console.log("[chain] Creating execution item for node", nodeId, {
                stageRunnableId,
                nodeDepth: node.depth,
                nodeType: node.entity.type,
                isTargeted: !!params.targetNodeId,
                hasHeaders: !!perSession?.headers,
                inputValueKeys: Object.keys(nodeInputs),
            })

            const stageExecutionItem = stageHandle.run({
                get,
                headers: perSession?.headers ?? {},
                repetitions: 1,
                runId,
                inputValues: nodeInputs,
            })
            if (!stageExecutionItem) {
                console.error("[chain] stageHandle.run() returned null for", stageRunnableId, {
                    nodeId,
                    nodeType: node.entity.type,
                    isTargeted: !!params.targetNodeId,
                })
                throw new Error(`Failed to build execution item for ${stageRunnableId}`)
            }

            console.log("[chain] Execution item for node", nodeId, {
                invocationUrl: stageExecutionItem.invocation.invocationUrl,
                requestBody: stageExecutionItem.invocation.requestBody,
                nodeInputs,
            })

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

            console.log("[chain] executeViaFetch result for node", nodeId, {
                status: result.status,
                hasOutput: !!result.output,
                hasError: !!result.error,
                errorMessage: result.error?.message,
                outputPreview:
                    typeof result.output === "string"
                        ? result.output.slice(0, 100)
                        : typeof result.output,
            })

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

            if (result.status === "error") {
                lifecycle.onFail({error: result.error || {message: "Execution failed"}})
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

    console.log("[executeViaFetch] About to fetch:", {
        invocationUrl,
        bodyKeys: Object.keys(requestBody),
        headerKeys: Object.keys(headers),
        hasAbortSignal: !!abortSignal,
    })

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

            try {
                const errorData = JSON.parse(errorText)
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
        console.error("[executeViaFetch] Fetch error:", {
            invocationUrl,
            errorName: error instanceof Error ? error.name : "unknown",
            errorMessage: error instanceof Error ? error.message : String(error),
        })

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
