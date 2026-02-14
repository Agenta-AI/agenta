import {
    resolveChainInputs,
    computeTopologicalOrder,
    runnableBridge,
    type RunnableType,
    type RunnableData,
    type ExecutionResult,
    type StageExecutionResult,
    type EntitySelection,
} from "@agenta/entities/runnable"
import type {Getter, Setter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import type {OutputConnection, PlaygroundNode} from "../types"

import {executionAdapterAtom, registerAbortController, cleanupAbortController} from "./atoms"
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
    primaryNode: PlaygroundNode
    allConnections: OutputConnection[]
    sessionOptions?: Record<string, SessionExecutionOptions>
    repetitionCount?: number
    lifecycle: ExecutionSessionLifecycleCallbacks
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
        primaryNode,
        allConnections,
        sessionOptions,
        repetitionCount = 1,
        lifecycle,
    } = params

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const perSession = sessionOptions?.[session.id]
    const primaryExecutionHandle = createExecutionItemHandle({
        loadableId,
        rowId: stepId,
        revisionId: session.runnableId,
        runId,
    })

    const abortController = new AbortController()
    registerAbortController(runId, abortController)
    lifecycle.onStart({runId})

    try {
        const runnableNodes = nodes.map(toRunnableNode)
        const downstreamConnections = allConnections.filter(
            (c) => c.sourceNodeId === primaryNode.id,
        )
        const isChain = downstreamConnections.length > 0
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

        for (let stageIndex = 0; stageIndex < (executionOrder?.length || 1); stageIndex++) {
            if (abortController.signal.aborted) {
                lifecycle.onCancel()
                return
            }

            const nodeId = executionOrder?.[stageIndex] || primaryNode.id
            const node = runnableNodes.find((n) => n.id === nodeId)
            if (!node) continue

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

            const nodeInputs =
                nodeId === primaryNode.id
                    ? {...data}
                    : resolveChainInputs(allConnections, nodeId, nodeResults, data)

            const stageRunnableId =
                nodeId === primaryNode.id ? session.runnableId : (node.entity.id as string)
            const stageRunnableType = (
                nodeId === primaryNode.id ? session.runnableType : node.entity.type
            ) as RunnableType
            const stageHandle =
                nodeId === primaryNode.id
                    ? primaryExecutionHandle
                    : createExecutionItemHandle({
                          loadableId,
                          rowId: stepId,
                          revisionId: stageRunnableId,
                      })

            const stageExecutionItem = stageHandle.run({
                get,
                headers: perSession?.headers ?? {},
                repetitions: 1,
                runId,
                inputValues: nodeInputs,
            })
            if (!stageExecutionItem) {
                throw new Error(`Failed to build execution item for ${stageRunnableId}`)
            }

            const store = getDefaultStore()
            const runnableData = store.get(
                runnableBridge.data(stageRunnableId),
            ) as RunnableData | null
            if (!runnableData) {
                throw new Error(`No runnable data for ${stageRunnableType}:${stageRunnableId}`)
            }

            const adapter = store.get(executionAdapterAtom)
            const result = await adapter.execute(stageRunnableType, runnableData, {
                inputs: nodeInputs,
                abortSignal: abortController.signal,
                rawBody:
                    nodeId === primaryNode.id && perSession?.rawBody
                        ? perSession.rawBody
                        : stageExecutionItem.invocation.requestBody,
                headers: {
                    ...stageExecutionItem.invocation.headers,
                    ...(perSession?.headers ?? {}),
                },
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

            if (result.status === "error") {
                lifecycle.onFail({error: result.error || {message: "Execution failed"}})
                return
            }
        }

        const primaryResult = nodeResults[primaryNode.id]
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

                const store2 = getDefaultStore()
                const runnableData2 = store2.get(
                    runnableBridge.data(session.runnableId),
                ) as RunnableData | null
                if (!runnableData2) break

                const adapter2 = store2.get(executionAdapterAtom)
                const perSession2 = sessionOptions?.[session.id]
                const nodeInputs2 = {...data}
                const repetitionItem = primaryExecutionHandle.retry({
                    get,
                    headers: perSession2?.headers ?? {},
                    repetitions: 1,
                    inputValues: nodeInputs2,
                })
                if (!repetitionItem) break

                try {
                    const repResult = await adapter2.execute(
                        session.runnableType as RunnableType,
                        runnableData2,
                        {
                            inputs: nodeInputs2,
                            abortSignal: abortController.signal,
                            rawBody: perSession2?.rawBody ?? repetitionItem.invocation.requestBody,
                            headers: {
                                ...repetitionItem.invocation.headers,
                                ...(perSession2?.headers ?? {}),
                            },
                        },
                    )

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

interface RunSessionsWithExecutionItemsParams {
    get: Getter
    set: Setter
    loadableId: string
    stepId: string
    sessions: ExecutionSession[]
    data: Record<string, unknown>
    nodes: PlaygroundNode[]
    primaryNode: PlaygroundNode
    allConnections: OutputConnection[]
    sessionOptions?: Record<string, SessionExecutionOptions>
    repetitionCount?: number
    concurrency: number
    createLifecycle: (session: ExecutionSession) => ExecutionSessionLifecycleCallbacks
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
        primaryNode,
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
                    primaryNode,
                    allConnections,
                    sessionOptions,
                    repetitionCount,
                    lifecycle: createLifecycle(session),
                }),
            ),
        ),
    )
}
