import {
    resolveChainInputs,
    computeTopologicalLevels,
    buildEvaluatorExecutionInputs,
    validateEvaluatorInputs,
    normalizeWorkflowResponse,
    type RequestPayloadData,
    type ExecutionResult,
    type StageExecutionResult,
    type EntitySelection,
} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {generateId} from "@agenta/shared/utils"
import type {Getter, Setter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {messageIdsAtomFamily, messagesByIdAtomFamily} from "../chat/messageAtoms"
import {SHARED_SESSION_ID, type ChatMessage} from "../chat/messageTypes"
import {reconcileRowDataForEntity} from "../helpers/entityInputContract"
import type {OutputConnection, PlaygroundNode} from "../types"

import {
    registerAbortController,
    cleanupAbortController,
    buildResultKey,
    resultsByKeyAtomFamily,
} from "./atoms"
import {createExecutionItemHandle} from "./executionItems"
import {extractSpanIdFromPayload, extractTraceIdFromPayload} from "./trace"
import type {ExecutionSession, RunResult, SessionExecutionOptions} from "./types"

interface RunnableNode {
    id: string
    entity: EntitySelection
    depth: number
}

type TraceReferenceMap = NonNullable<RequestPayloadData["references"]>

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function toPlainChatMessage(message: ChatMessage): Record<string, unknown> {
    const {sessionId: _sessionId, parentId: _parentId, ...plain} = message
    return plain as Record<string, unknown>
}

function buildSharedChatInputs(get: Getter, loadableId: string): Record<string, unknown> {
    const messageIds = get(messageIdsAtomFamily(loadableId))
    const messagesById = get(messagesByIdAtomFamily(loadableId))

    const messages = messageIds
        .map((messageId) => messagesById[messageId])
        .filter((message): message is ChatMessage => Boolean(message))
        .filter((message) => message.sessionId === SHARED_SESSION_ID)
        .map(toPlainChatMessage)

    return messages.length > 0 ? {messages} : {}
}

function normalizeApplicationReferences(
    references: RequestPayloadData["references"],
): TraceReferenceMap | undefined {
    if (!references) return undefined

    const appRef = asRecord(references.application)
    const appVariantRef = asRecord(references.application_variant)
    const appRevisionRef = asRecord(references.application_revision)
    const normalized: TraceReferenceMap = {}

    const applicationId = readString(appRef?.id)
    const applicationSlug = readString(appRef?.slug)
    if (applicationId || applicationSlug) {
        normalized.application = {
            ...(applicationId ? {id: applicationId} : {}),
            ...(applicationSlug ? {slug: applicationSlug} : {}),
        }
    }

    const applicationVariantId = readString(appVariantRef?.id) || readString(appRef?.variant_id)
    const applicationVariantSlug = readString(appVariantRef?.slug)
    if (applicationVariantId || applicationVariantSlug) {
        normalized.application_variant = {
            ...(applicationVariantId ? {id: applicationVariantId} : {}),
            ...(applicationVariantSlug ? {slug: applicationVariantSlug} : {}),
        }
    }

    const applicationRevisionId = readString(appRevisionRef?.id) || readString(appRef?.revision_id)
    const applicationRevisionSlug = readString(appRevisionRef?.slug)
    const applicationRevisionVersion = readString(appRevisionRef?.version)
    if (applicationRevisionId || applicationRevisionSlug || applicationRevisionVersion) {
        normalized.application_revision = {
            ...(applicationRevisionId ? {id: applicationRevisionId} : {}),
            ...(applicationRevisionSlug ? {slug: applicationRevisionSlug} : {}),
            ...(applicationRevisionVersion ? {version: applicationRevisionVersion} : {}),
        }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
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

function buildUpstreamLinks(params: {
    incomingConnection?: OutputConnection
    runnableNodes: RunnableNode[]
    nodeResults: Record<string, ExecutionResult>
}): Record<string, {trace_id: string; span_id: string}> | undefined {
    const sourceNodeId = params.incomingConnection?.sourceNodeId
    if (!sourceNodeId) return undefined

    const sourceResult = params.nodeResults[sourceNodeId]
    const traceId =
        sourceResult?.trace?.id || extractTraceIdFromPayload(sourceResult?.structuredOutput)
    const spanId =
        sourceResult?.trace?.spanId || extractSpanIdFromPayload(sourceResult?.structuredOutput)

    if (!traceId || !spanId) return undefined

    const sourceNode = params.runnableNodes.find((node) => node.id === sourceNodeId)
    const linkKey = sourceNode?.depth === 0 ? "application" : sourceNodeId

    return {
        [linkKey]: {
            trace_id: traceId,
            span_id: spanId,
        },
    }
}

function buildUpstreamReferences(params: {
    get: Getter
    incomingConnection?: OutputConnection
    runnableNodes: RunnableNode[]
}): TraceReferenceMap | undefined {
    const sourceNodeId = params.incomingConnection?.sourceNodeId
    if (!sourceNodeId) return undefined

    const sourceNode = params.runnableNodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) return undefined

    const sourcePayload = params.get(
        workflowMolecule.selectors.requestPayload(sourceNode.entity.id),
    ) as RequestPayloadData | null

    return normalizeApplicationReferences(sourcePayload?.references)
}

/**
 * Build the `references.evaluator{,_variant,_revision}` map for a chain stage
 * whose target node is an evaluator.
 *
 * The playground node's `entity.id` is a REVISION id. We read the merged
 * revision record from the workflow molecule and pull both the revision-level
 * fields (id / slug / version) and the parent workflow + variant identity
 * (workflow_id, workflow_slug, workflow_variant_id, workflow_variant_slug)
 * that the backend writes on revision responses.
 *
 * The trace storage layer indexes evaluator references by these fields:
 *   - `references.evaluator.{id, slug}` ← parent workflow identity
 *   - `references.evaluator_variant.{id, slug}` ← parent variant identity
 *   - `references.evaluator_revision.{id, slug, version}` ← this revision
 *
 * Without these, traces emitted from playground chain runs don't surface on
 * the evaluator's `/apps/<evalId>/traces` page — the page filters by
 * `references.evaluator.slug`, and a missing slot returns 0 matches.
 * Matches the shape backend evaluation runs emit (verified against real
 * auto-evaluation trace data on 2026-05-28).
 *
 * Returns `undefined` when the node isn't an evaluator workflow, or when the
 * revision data isn't available yet (rare — only during initial hydration).
 */
function buildEvaluatorSelfReferences(params: {
    get: Getter
    revisionId: string
}): TraceReferenceMap | undefined {
    const revision = params.get(workflowMolecule.selectors.data(params.revisionId)) as
        | (Record<string, unknown> & {flags?: Record<string, unknown> | null})
        | null
    if (!revision) return undefined
    if (!revision.flags?.is_evaluator) return undefined

    const refs: TraceReferenceMap = {}

    // evaluator (parent workflow)
    const workflowId = readString(revision.workflow_id)
    const workflowSlug = readString(revision.workflow_slug)
    if (workflowId || workflowSlug) {
        refs.evaluator = {
            ...(workflowId ? {id: workflowId} : {}),
            ...(workflowSlug ? {slug: workflowSlug} : {}),
        }
    }

    // evaluator_variant (parent variant)
    const variantId = readString(revision.workflow_variant_id) ?? readString(revision.variant_id)
    const variantSlug = readString(revision.workflow_variant_slug)
    if (variantId || variantSlug) {
        refs.evaluator_variant = {
            ...(variantId ? {id: variantId} : {}),
            ...(variantSlug ? {slug: variantSlug} : {}),
        }
    }

    // evaluator_revision (this revision)
    const revisionId = readString(revision.id) ?? params.revisionId
    const revisionSlug = readString(revision.slug)
    const revisionVersion =
        typeof revision.version === "number"
            ? String(revision.version)
            : readString(revision.version)
    if (revisionId || revisionSlug || revisionVersion) {
        refs.evaluator_revision = {
            ...(revisionId ? {id: revisionId} : {}),
            ...(revisionSlug ? {slug: revisionSlug} : {}),
            ...(revisionVersion ? {version: revisionVersion} : {}),
        }
    }

    return Object.keys(refs).length > 0 ? refs : undefined
}

/**
 * Reconcile row data to an entity's input contract at execution time.
 *
 * This is the runtime safety net for #4525 / AGE-3793: testcase rows live in
 * a shared store and preserve every key the user ever ran with (chat apps
 * populate `messages`, completion apps populate template variables, etc.).
 * When the user swaps the primary app, the same row carries stale keys.
 *
 * Reconciliation primarily happens at swap time in the playground controller
 * (`pruneTestcaseRowsForEntity`); this pass catches the hydration window
 * where the new entity's input contract wasn't yet resolved at swap time but
 * IS resolved by the time the request is built.
 *
 * Delegates to the shared `reconcileRowDataForEntity` — allow-list derived
 * from `inputPorts` (the same source `executionItems` uses for `variables`),
 * NOT `inputSchema.properties` (empty for completion apps). Apps get a strict
 * allow-list; evaluators / unresolved contracts get a chat-transport-only
 * strip so workflows depending on extra testcase columns keep working.
 */
function reconcileEntityInputData(
    get: Getter,
    data: Record<string, unknown>,
    entityId: string,
): Record<string, unknown> {
    const {data: next, dropped, strategy} = reconcileRowDataForEntity(get, entityId, data)
    if (dropped.length > 0) {
        console.warn("[executionRunner.filter] reconciled stale row keys", {
            entityId,
            strategy,
            dropped,
        })
    }
    return next
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
                        // Reconcile the row to the root entity's input contract so
                        // stale keys from a previous primary app (e.g. chat `messages`
                        // / `context` after swapping the upstream app in the
                        // LLM-as-a-judge playground — issue #4525 / AGE-3793) don't
                        // leak into the new app's request body via the downstream
                        // "spread all keys" fallback in resolveVariableValues. Apps
                        // get a strict allow-list (from inputPorts); evaluators get a
                        // chat-transport-only strip.
                        const rootEntityId = node.entity.id as string
                        nodeInputs = reconcileEntityInputData(get, data, rootEntityId)
                    } else {
                        // Reconcile testcase data before chain / evaluator input
                        // construction, so the downstream "spread all keys" fallbacks
                        // (resolveChainInputs no-mapping branch and
                        // buildEvaluatorExecutionInputs additionalProperties spread)
                        // can't carry stale keys from a previous app into the current
                        // target entity (#4525 / AGE-3793).
                        const targetEntityId = node.entity.id as string
                        const dataForChain = reconcileEntityInputData(get, data, targetEntityId)

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
                                dataForChain,
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
                            const stageConfiguration = evalStore.get(
                                workflowMolecule.selectors.configuration(targetEntityId),
                            )
                            const stageSchemas = evalStore.get(
                                workflowMolecule.selectors.ioSchemas(targetEntityId),
                            )
                            const inputSchema =
                                (stageSchemas?.inputSchema as
                                    | Record<string, unknown>
                                    | undefined) ?? null
                            const rootChatInputs =
                                session.mode === "chat"
                                    ? buildSharedChatInputs(get, loadableId)
                                    : undefined
                            // Base the evaluator testcase on the stripped
                            // `dataForChain` (not raw `data`) so stale chat-
                            // transport keys from a previous chat app can't leak
                            // in (#4525 / AGE-3793), then layer the current
                            // shared chat inputs on top for chat-mode runs.
                            const evaluatorTestcaseData =
                                rootChatInputs && Object.keys(rootChatInputs).length > 0
                                    ? {...dataForChain, ...rootChatInputs}
                                    : dataForChain

                            const evaluatorInputContext = {
                                testcaseData: evaluatorTestcaseData,
                                upstreamOutput,
                                settings: stageConfiguration ?? {},
                                inputSchema,
                            }

                            // Validate required inputs before building — skip if missing
                            const validation = validateEvaluatorInputs(evaluatorInputContext)
                            if (!validation.valid) {
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

                            nodeInputs = buildEvaluatorExecutionInputs(evaluatorInputContext)
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

                    const stageLinks =
                        node.depth > 0
                            ? buildUpstreamLinks({
                                  incomingConnection: allConnections.find(
                                      (connection) => connection.targetNodeId === nodeId,
                                  ),
                                  runnableNodes,
                                  nodeResults,
                              })
                            : undefined
                    const stageReferences = (() => {
                        if (node.depth === 0) return undefined
                        const upstream = buildUpstreamReferences({
                            get,
                            incomingConnection: allConnections.find(
                                (connection) => connection.targetNodeId === nodeId,
                            ),
                            runnableNodes,
                        })
                        // For evaluator stages, also attach the evaluator's
                        // own identity so the emitted trace can be found via
                        // `references.evaluator.slug` on the evaluator's
                        // /apps/<evalId>/traces page. Merges with upstream
                        // application refs (the app being scored).
                        const selfEval = buildEvaluatorSelfReferences({
                            get,
                            revisionId: node.entity.id as string,
                        })
                        if (!upstream && !selfEval) return undefined
                        return {...(upstream ?? {}), ...(selfEval ?? {})}
                    })()

                    const stageExecutionItem = stageHandle.run({
                        get,
                        headers: perSession?.headers ?? {},
                        repetitions: 1,
                        runId,
                        inputValues: nodeInputs,
                        references: stageReferences,
                        links: stageLinks,
                        projectId,
                    })
                    if (!stageExecutionItem) {
                        throw new Error(`Failed to build execution item for ${stageRunnableId}`)
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
                            normalizeWorkflowResponse(responseData),
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
                // Same reconciliation as the first-run path above — repetitions
                // hit the same root entity, so stale keys must be filtered
                // identically (issue #4525 / AGE-3793).
                const nodeInputs2 = reconcileEntityInputData(get, data, session.runnableId)
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
    normalizeResponse?: (responseData: unknown) => {
        output: unknown
        trace?: {id: string; spanId?: string}
    }
}): Promise<ExecutionResult> {
    const {invocationUrl, requestBody, headers, abortSignal, normalizeResponse} = params
    const executionId = generateId()
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
                  trace: responseData?.trace_id
                      ? {
                            id: responseData.trace_id as string,
                            ...(responseData?.span_id
                                ? {spanId: responseData.span_id as string}
                                : {}),
                        }
                      : undefined,
              }

        const fallbackTraceId = extractTraceIdFromPayload(responseData)
        const fallbackSpanId = extractSpanIdFromPayload(responseData)
        const trace =
            normalized.trace?.id || fallbackTraceId
                ? {
                      id: normalized.trace?.id || fallbackTraceId || "",
                      ...(normalized.trace?.spanId || fallbackSpanId
                          ? {spanId: normalized.trace?.spanId || fallbackSpanId || undefined}
                          : {}),
                  }
                : undefined

        return {
            executionId,
            status: "success",
            startedAt,
            completedAt: new Date().toISOString(),
            output: normalized.output,
            structuredOutput: responseData,
            trace,
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
