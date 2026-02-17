import {
    stripAgentaMetadataDeep,
    stripEnhancedWrappers,
    transformToRequestBody,
    type OpenAPISpec,
    type TransformMessage,
    type TransformVariantInput,
} from "@agenta/entities/legacyAppRevision"
import {
    loadableController,
    runnableBridge,
    type RequestPayloadData,
} from "@agenta/entities/runnable"
import {getAgentaApiUrl} from "@agenta/shared/api/env"
import {generateId} from "@agenta/shared/utils"
import {atom, type Getter, type Setter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {entityIdsAtom} from "../atoms/playground"
import {messageIdsAtomFamily, messagesByIdAtomFamily} from "../chat/messageAtoms"
import {
    addMessageAtom,
    addMessagesAtom,
    completeMessageExecutionAtom,
    generateMessageId,
} from "../chat/messageReducer"
import type {ChatMessage} from "../chat/messageTypes"
import {SHARED_SESSION_ID} from "../chat/messageTypes"
import {buildAssistantMessage, buildToolMessages} from "../helpers/messageFactory"

import {
    repetitionCountAtom,
    repetitionIndexAtomFamily,
    resultAtomFamily,
    resultsByKeyAtomFamily,
    buildResultKey,
    abortRun,
    executionAdapterAtom,
} from "./atoms"
import {completeRunAtom} from "./reducer"
import {isChatModeAtom} from "./selectors"
import {extractTraceIdFromPayload} from "./trace"
import type {ExecutionMode, RunResult, RunStatus} from "./types"

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutionItemReference {
    loadableId: string
    rowId: string
    entityId: string
    sessionId: string
    messageId?: string
}

export interface ExecutionItemInvocation {
    runId: string
    invocationUrl: string
    requestBody: Record<string, unknown>
    headers: Record<string, string>
    repetitions: number
}

export interface WorkerRunEntityRowPayload {
    runId: string
    rowId: string
    entityId: string
    messageId?: string
    invocationUrl: string
    requestBody: Record<string, unknown>
    headers: Record<string, string>
    repetitions: number
}

export interface ExecutionItem {
    id: string
    mode: ExecutionMode
    references: ExecutionItemReference
    invocation: ExecutionItemInvocation
    workerPayload: WorkerRunEntityRowPayload
}

export interface CreateExecutionItemParams {
    loadableId: string
    rowId: string
    entityId: string
    /** When provided, scopes bridge selectors to this entity type only.
     *  Without this, the bridge probes all molecule types — which can
     *  match the wrong molecule when entity IDs exist in a shared DB table. */
    entityType?: string
    runId?: string
    messageId?: string
}

export interface ExecutionItemRunParams {
    get: Getter
    headers: Record<string, string>
    repetitions?: number
    runId?: string
    inputValues?: Record<string, unknown>
    projectId?: string | null
    dispatchWorkerRun?: (payload: WorkerRunEntityRowPayload) => void
    /** Pre-built chat history. When provided, skips internal turn-based history building. */
    chatHistory?: TransformMessage[]
}

export interface ExecutionItemCancelParams {
    get: Getter
    set: Setter
    dispatchWorkerCancel?: (runId: string) => void
}

export type ExecutionItemLifecyclePhase = "idle" | "running" | "success" | "failed" | "cancelled"

export interface ExecutionItemLifecycleSnapshot {
    status: RunStatus
    phase: ExecutionItemLifecyclePhase
    runId: string | null
    error: {message: string; code?: string} | null
    isRunning: boolean
    isFailed: boolean
    canRetry: boolean
    startedAt?: number
    completedAt?: number
    resultHash: string | null
    repetitionCount: number
    repetitionIndex: number
    attemptCount: number
    retryCount: number
}

export interface ExecutionItemLifecycleApi {
    snapshot: (get: Getter) => ExecutionItemLifecycleSnapshot
    isRunning: (get: Getter) => boolean
    isFailed: (get: Getter) => boolean
    canRetry: (get: Getter) => boolean
    repetitionCount: (get: Getter) => number
    repetitionIndex: (get: Getter) => number
}

export interface ExecutionItemHandle {
    id: string
    references: ExecutionItemReference
    lifecycle: ExecutionItemLifecycleApi
    run: (params: ExecutionItemRunParams) => ExecutionItem | null
    retry: (params: Omit<ExecutionItemRunParams, "runId">) => ExecutionItem | null
    cancel: (params: ExecutionItemCancelParams) => void
}

export interface AgConfigFallbackCandidate {
    source: string
    value: unknown
}

interface BuildExecutionItemBaseParams {
    loadableId: string
    rowId: string
    entityId: string
    runId: string
    messageId?: string
    headers: Record<string, string>
    repetitions: number
    projectId?: string | null
    entityData?: TransformVariantInput | null
    requestPayload?: RequestPayloadData | null
    invocationUrl?: string | null
    variables?: string[]
    variableValues?: Record<string, string>
    agConfigFallbacks?: AgConfigFallbackCandidate[]
    /** Runtime-resolved inputs (e.g. from chain upstream). Merged into rawBody.inputs when __rawBody is true. */
    inputValues?: Record<string, unknown>
}

export interface BuildCompletionExecutionItemParams extends BuildExecutionItemBaseParams {
    inputRow?: Record<string, unknown>
}

export interface BuildChatExecutionItemParams extends BuildExecutionItemBaseParams {
    chatHistory?: TransformMessage[]
}

interface ResolveVariableRowIdParams {
    mode: ExecutionMode
    executionRowId: string
    displayRowIds: string[]
}

interface ResolveVariableValuesParams {
    allowedVariableKeys: string[]
    sourceRowData?: Record<string, unknown> | null
}

interface BuildCompletionInputRowParams {
    rowId: string
    allowedVariableKeys: string[]
    sourceRowData?: Record<string, unknown> | null
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

const MODEL_ATTACHMENT_ALLOWLIST = ["gemini"]

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

function extractLogicalRowId(rowId: string): string {
    const sessionMatch = /^turn-([^-]+)-(lt-.+)$/.exec(String(rowId))
    return sessionMatch?.[2] || rowId
}

function mapLifecyclePhase(status: RunStatus): ExecutionItemLifecyclePhase {
    if (status === "running" || status === "pending") return "running"
    if (status === "error") return "failed"
    return status
}

function resolveRunResult(get: Getter, references: ExecutionItemReference): RunResult | null {
    return get(
        resultAtomFamily({
            loadableId: references.loadableId,
            stepId: references.rowId,
            sessionId: references.sessionId,
        }),
    )
}

function resolveRequestedRepetitions(
    get: Getter,
    requestedRepetitions: number | undefined,
): number {
    const compareCount = (get(entityIdsAtom) || []).length
    if (compareCount > 1) return 1

    const globalCount = get(repetitionCountAtom)
    const preferred = Number.isFinite(requestedRepetitions)
        ? Number(requestedRepetitions)
        : globalCount
    return Math.max(1, preferred)
}

function cancelExecutionItemRun(
    get: Getter,
    set: Setter,
    references: ExecutionItemReference,
): string | null {
    const resultsByKey = {
        ...get(resultsByKeyAtomFamily(references.loadableId)),
    }
    const key = buildResultKey(references.rowId, references.sessionId)
    const existing = resultsByKey[key]
    if (!existing || (existing.status !== "running" && existing.status !== "pending")) {
        return null
    }

    if (existing.runId) {
        abortRun(existing.runId)
        const store = getDefaultStore()
        const adapter = store.get(executionAdapterAtom)
        adapter.cancel?.(existing.runId)
    }

    resultsByKey[key] = {
        ...existing,
        status: "cancelled",
        completedAt: Date.now(),
    }
    set(resultsByKeyAtomFamily(references.loadableId), resultsByKey)
    return existing.runId ?? null
}

function resolveVariableRowId(params: ResolveVariableRowIdParams): string | null {
    const {mode, executionRowId, displayRowIds} = params
    if (!Array.isArray(displayRowIds) || displayRowIds.length === 0) return null

    if (mode === "chat") return displayRowIds[0]
    if (displayRowIds.includes(executionRowId)) return executionRowId
    return displayRowIds[0] ?? null
}

function resolveVariableValues(params: ResolveVariableValuesParams): Record<string, string> {
    const {allowedVariableKeys, sourceRowData} = params
    const source = sourceRowData ?? {}

    if (Array.isArray(allowedVariableKeys) && allowedVariableKeys.length > 0) {
        const values: Record<string, string> = {}
        for (const key of allowedVariableKeys) {
            const value = source[key]
            values[key] = value !== undefined && value !== null ? String(value) : ""
        }
        return values
    }

    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(source)) {
        values[key] = value !== undefined && value !== null ? String(value) : ""
    }
    return values
}

function buildCompletionInputRow(
    params: BuildCompletionInputRowParams,
): Record<string, unknown> | undefined {
    const {rowId, allowedVariableKeys, sourceRowData} = params
    if (!sourceRowData) return undefined

    const keys = allowedVariableKeys.length > 0 ? allowedVariableKeys : Object.keys(sourceRowData)
    const enhanced: Record<string, unknown> = {__id: rowId}

    for (const key of keys) {
        const value = sourceRowData[key]
        enhanced[key] = {value: value !== undefined && value !== null ? String(value) : ""}
    }

    return enhanced
}

/**
 * Build chat history from the flat message model.
 *
 * Walks messageIds in order, includes shared messages and session-owned messages.
 * Strips `sessionId` and `parentId` — returns pure TransformMessage[].
 *
 * Optionally stops before a given messageId (for providing context up to a point).
 */
function buildChatHistoryFromFlatMessages(params: {
    messageIds: string[]
    messagesById: Record<string, ChatMessage>
    sessionId: string
    beforeMessageId?: string
}): TransformMessage[] {
    const {messageIds, messagesById, sessionId, beforeMessageId} = params
    const sharedSessionId = SHARED_SESSION_ID

    const history: TransformMessage[] = []
    for (const msgId of messageIds) {
        if (beforeMessageId && msgId === beforeMessageId) break

        const msg = messagesById[msgId]
        if (!msg) continue

        if (msg.sessionId === sharedSessionId || msg.sessionId === sessionId) {
            const {sessionId: _s, parentId: _p, ...apiMsg} = msg
            history.push(apiMsg as unknown as TransformMessage)
        }
    }

    return history
}

export function createExecutionItemHandle(params: CreateExecutionItemParams): ExecutionItemHandle {
    const references: ExecutionItemReference = {
        loadableId: params.loadableId,
        rowId: params.rowId,
        entityId: params.entityId,
        sessionId: `sess:${params.entityId}`,
        ...(params.messageId ? {messageId: params.messageId} : {}),
    }

    let attemptCount = 0
    let lastRunId: string | null = params.runId ?? null
    let lastRequestedRepetitions = 1

    const buildLifecycleSnapshot = (get: Getter): ExecutionItemLifecycleSnapshot => {
        const result = resolveRunResult(get, references)
        const status: RunStatus = result?.status ?? "idle"
        const repetitionKey = `${references.rowId}:${references.entityId}`
        const repetitionIndexRaw = get(repetitionIndexAtomFamily(repetitionKey))
        const repetitionCountFromResult =
            Array.isArray(result?.repetitions) && result.repetitions.length > 0
                ? result.repetitions.length
                : 1
        const repetitionCount = Math.max(
            resolveRequestedRepetitions(get, undefined),
            lastRequestedRepetitions,
            repetitionCountFromResult,
        )
        const repetitionIndex = Math.min(
            Math.max(0, Number.isFinite(repetitionIndexRaw) ? repetitionIndexRaw : 0),
            Math.max(0, repetitionCount - 1),
        )

        return {
            status,
            phase: mapLifecyclePhase(status),
            runId: result?.runId ?? lastRunId ?? null,
            error: result?.error ?? null,
            isRunning: status === "running" || status === "pending",
            isFailed: status === "error",
            canRetry: status !== "running" && status !== "pending",
            startedAt: result?.startedAt,
            completedAt: result?.completedAt,
            resultHash: result?.resultHash ?? null,
            repetitionCount,
            repetitionIndex,
            attemptCount,
            retryCount: Math.max(0, attemptCount - 1),
        }
    }

    const buildExecutionItemFromRunParams = (
        runParams: ExecutionItemRunParams,
        forceNewRunId: boolean,
    ): ExecutionItem | null => {
        const {get, headers, repetitions, runId, inputValues, projectId, dispatchWorkerRun} =
            runParams

        // When entityType is provided, use type-scoped selectors to avoid
        // cross-contamination from the shared workflow_revisions DB table.
        // Without scoping, legacyAppRevision can match evaluator IDs and
        // return the wrong invocation URL (/test instead of /evaluators/{key}/run).
        const bridge = params.entityType
            ? runnableBridge.forType(params.entityType)
            : runnableBridge

        const mode: ExecutionMode =
            get(bridge.executionMode(params.entityId)) === "chat" ? "chat" : "completion"
        const normalizedRepetitions = resolveRequestedRepetitions(get, repetitions)
        const effectiveRunId =
            runId ?? (!forceNewRunId && params.runId ? params.runId : undefined) ?? generateId()

        const requestPayload = get(
            bridge.requestPayload(params.entityId),
        ) as RequestPayloadData | null
        const invocationUrl = get(bridge.invocationUrl(params.entityId)) as string | null
        const runnableData = get(bridge.data(params.entityId)) as TransformVariantInput | null
        const entityData = runnableData ?? null

        const variables = requestPayload?.variables ?? []

        const displayRowIds = get(loadableController.selectors.displayRowIds(params.loadableId))
        if (!Array.isArray(displayRowIds) || displayRowIds.length === 0) {
            console.warn("[executionItem.run] No displayRowIds for", params.entityId, {
                loadableId: params.loadableId,
            })
            return null
        }

        const variableSourceRowId = resolveVariableRowId({
            mode,
            executionRowId: params.rowId,
            displayRowIds,
        })
        if (!variableSourceRowId) {
            console.warn("[executionItem.run] No variableSourceRowId for", params.entityId, {
                mode,
                rowId: params.rowId,
                displayRowIds: displayRowIds.slice(0, 5),
            })
            return null
        }

        const variableSourceRow = get(
            loadableController.selectors.row(params.loadableId, variableSourceRowId),
        ) as {id: string; data?: Record<string, unknown>} | null
        const variableSourceRowData = variableSourceRow?.data ?? null
        if (mode === "completion" && !variableSourceRowData) {
            console.warn("[executionItem.run] No variableSourceRowData for", params.entityId, {
                mode,
                variableSourceRowId,
                hasRow: !!variableSourceRow,
            })
            return null
        }

        const variableSourceDataForExecution = inputValues ?? variableSourceRowData

        const variableValues = resolveVariableValues({
            allowedVariableKeys: variables,
            sourceRowData: variableSourceDataForExecution,
        })

        const completionInputRow =
            mode === "completion"
                ? buildCompletionInputRow({
                      rowId: variableSourceRowId,
                      allowedVariableKeys: variables,
                      sourceRowData: variableSourceDataForExecution,
                  })
                : undefined

        const chatHistory =
            mode === "chat"
                ? (runParams.chatHistory ??
                  (() => {
                      const allMsgIds = get(messageIdsAtomFamily(params.loadableId))
                      const allMsgsById = get(messagesByIdAtomFamily(params.loadableId))
                      const logicalRowId = extractLogicalRowId(params.rowId)

                      // Find the cut point: include messages up to the next shared message after logicalRowId
                      const rowIdx = allMsgIds.indexOf(logicalRowId)
                      let cutIdx = allMsgIds.length
                      if (rowIdx >= 0) {
                          for (let i = rowIdx + 1; i < allMsgIds.length; i++) {
                              const m = allMsgsById[allMsgIds[i]] as ChatMessage | undefined
                              if (m && m.sessionId === SHARED_SESSION_ID) {
                                  cutIdx = i
                                  break
                              }
                          }
                      }
                      const limitedIds = allMsgIds.slice(0, cutIdx)

                      return buildChatHistoryFromFlatMessages({
                          messageIds: limitedIds,
                          messagesById: allMsgsById,
                          sessionId: references.sessionId,
                      })
                  })())
                : undefined

        const agConfigFallbacks: AgConfigFallbackCandidate[] = [
            {source: "requestPayload.ag_config", value: requestPayload?.ag_config},
            {
                source: "runnableBridge.configuration",
                value: get(bridge.configuration(params.entityId)) as unknown,
            },
            {
                source: "entityData.parameters",
                value:
                    (entityData as {parameters?: unknown} | null | undefined)?.parameters ?? null,
            },
        ]

        const executionItem =
            mode === "chat"
                ? buildChatExecutionItem({
                      loadableId: params.loadableId,
                      rowId: params.rowId,
                      entityId: params.entityId,
                      runId: effectiveRunId,
                      messageId: params.messageId,
                      headers,
                      repetitions: normalizedRepetitions,
                      projectId,
                      entityData,
                      requestPayload,
                      invocationUrl,
                      variables,
                      variableValues,
                      chatHistory,
                      agConfigFallbacks,
                      inputValues,
                  })
                : buildCompletionExecutionItem({
                      loadableId: params.loadableId,
                      rowId: params.rowId,
                      entityId: params.entityId,
                      runId: effectiveRunId,
                      messageId: params.messageId,
                      headers,
                      repetitions: normalizedRepetitions,
                      projectId,
                      entityData,
                      requestPayload,
                      invocationUrl,
                      variables,
                      variableValues,
                      inputRow: completionInputRow,
                      agConfigFallbacks,
                      inputValues,
                  })

        lastRequestedRepetitions = executionItem.invocation.repetitions
        lastRunId = executionItem.invocation.runId
        attemptCount += 1

        dispatchWorkerRun?.(executionItem.workerPayload)
        return executionItem
    }

    return {
        id: `${params.entityId}:${params.rowId}`,
        references,
        lifecycle: {
            snapshot: buildLifecycleSnapshot,
            isRunning: (get) => buildLifecycleSnapshot(get).isRunning,
            isFailed: (get) => buildLifecycleSnapshot(get).isFailed,
            canRetry: (get) => buildLifecycleSnapshot(get).canRetry,
            repetitionCount: (get) => buildLifecycleSnapshot(get).repetitionCount,
            repetitionIndex: (get) => buildLifecycleSnapshot(get).repetitionIndex,
        },
        run: (runParams) => buildExecutionItemFromRunParams(runParams, false),
        retry: (runParams) => buildExecutionItemFromRunParams(runParams, true),
        cancel: ({get, set, dispatchWorkerCancel}) => {
            const cancelledRunId = cancelExecutionItemRun(get, set, references)
            if (cancelledRunId) dispatchWorkerCancel?.(cancelledRunId)
        },
    }
}

function resolveBaseUrl(): string {
    return getAgentaApiUrl() || (globalThis.location?.origin ?? "")
}

function constructPlaygroundTestPath(runtimePrefix: string, routePath?: string): string {
    return `${runtimePrefix}${routePath ? `/${routePath}` : ""}/test`
}

function isSupportedFetchProtocol(protocol: string): boolean {
    return protocol === "http:" || protocol === "https:"
}

function resolveExplicitInvocationCandidate(candidate: string, baseUrl: string): string | null {
    try {
        const absolute = new URL(candidate)
        return isSupportedFetchProtocol(absolute.protocol) ? absolute.toString() : null
    } catch {
        if (baseUrl) {
            try {
                const resolved = new URL(candidate, baseUrl)
                return isSupportedFetchProtocol(resolved.protocol) ? resolved.toString() : null
            } catch {
                return candidate
            }
        }
        return candidate
    }
}

function resolveInvocationUrl(
    invocationUrl: string | null | undefined,
    requestPayload: RequestPayloadData | null | undefined,
    entityData: TransformVariantInput | null | undefined,
): string {
    const bridgeInvocationUrl = readString(invocationUrl)
    const requestPayloadInvocationUrl = readString(requestPayload?.invocationUrl)
    const entityInvocationUrl = readString(entityData?.invocationUrl)
    const entityUri = readString(
        (entityData as Record<string, unknown> | null | undefined)?.uri as string | undefined,
    )
    const baseUrl = resolveBaseUrl()

    const explicitCandidates = [
        bridgeInvocationUrl,
        requestPayloadInvocationUrl,
        entityInvocationUrl,
        entityUri,
    ].filter((value): value is string => Boolean(value))

    for (const candidate of explicitCandidates) {
        // Guard against non-fetchable schemes (e.g. "agenta:...") while still
        // allowing valid relative URLs like "/api/evaluators/{key}/run".
        const resolved = resolveExplicitInvocationCandidate(candidate, baseUrl)
        if (resolved) {
            return resolved
        }
    }

    const runtimePrefix = readString(requestPayload?.runtimePrefix) || ""
    const routePath = readString(requestPayload?.routePath)
    const path = constructPlaygroundTestPath(runtimePrefix, routePath)

    if (!baseUrl) return path
    try {
        return new URL(path, baseUrl).toString()
    } catch {
        return path
    }
}

function appendQueryParams(
    invocationUrl: string,
    params: Record<string, string | undefined>,
): string {
    const entries = Object.entries(params).filter(([, value]) => Boolean(value))
    if (entries.length === 0) return invocationUrl

    try {
        const url = new URL(invocationUrl)
        for (const [key, value] of entries) {
            if (!value) continue
            url.searchParams.set(key, value)
        }
        return url.toString()
    } catch {
        const query = new URLSearchParams(
            entries.reduce<Record<string, string>>((acc, [key, value]) => {
                if (value) acc[key] = value
                return acc
            }, {}),
        ).toString()
        if (!query) return invocationUrl
        return invocationUrl.includes("?")
            ? `${invocationUrl}&${query}`
            : `${invocationUrl}?${query}`
    }
}

export function resolveAgConfigCandidate(value: unknown): Record<string, unknown> {
    const rec = asRecord(value)
    if (!rec) return {}

    const nested = asRecord(rec.ag_config) ?? asRecord(rec.agConfig)
    if (nested) return nested
    return rec
}

function firstNonEmptyAgConfig(
    candidates: AgConfigFallbackCandidate[] | undefined,
): Record<string, unknown> | null {
    for (const candidate of candidates || []) {
        const resolved = resolveAgConfigCandidate(candidate.value)
        if (Object.keys(resolved).length > 0) return resolved
    }
    return null
}

function getPromptModel(
    entityData: TransformVariantInput | null | undefined,
    requestBody: Record<string, unknown>,
): string | undefined {
    const agConfig = asRecord(requestBody.ag_config)
    const promptFromConfig = asRecord(agConfig?.prompt)
    const promptsFromConfig = Array.isArray(agConfig?.prompts) ? agConfig?.prompts : []
    const firstPromptFromConfig =
        promptsFromConfig.length > 0 ? asRecord(promptsFromConfig[0]) : null

    const entityParams = asRecord(entityData?.parameters)
    const entityAgConfig = (() => {
        const fromSnake = resolveAgConfigCandidate(entityParams?.ag_config)
        if (Object.keys(fromSnake).length > 0) return fromSnake
        return resolveAgConfigCandidate(entityParams?.agConfig)
    })()

    const promptFromEntityAgConfig = asRecord(entityAgConfig.prompt)
    const promptFromEntityParams = asRecord(entityParams?.prompt)

    const candidates = [
        promptFromConfig,
        firstPromptFromConfig,
        promptFromEntityAgConfig,
        promptFromEntityParams,
    ]

    for (const prompt of candidates) {
        if (!prompt) continue
        const llmConfig = asRecord(prompt.llm_config) ?? asRecord(prompt.llmConfig)
        const model = readString(llmConfig?.model)
        if (model) return model
    }

    return undefined
}

function isFileReference(value: string): boolean {
    return /^https?:\/\//i.test(value) || value.startsWith("file_") || value.startsWith("file-")
}

function normalizeFileMessageParts(messages: unknown[]): void {
    for (const message of messages) {
        const messageRec = asRecord(message)
        if (!messageRec) continue
        const content = Array.isArray(messageRec.content) ? messageRec.content : null
        if (!content) continue

        for (const part of content) {
            const partRec = asRecord(part)
            if (!partRec) continue
            if (partRec.type !== "file") continue

            const file = asRecord(partRec.file)
            if (!file) continue

            const fileId = readString(file.file_id)
            if (fileId && fileId.startsWith("data:")) {
                file.file_data = fileId
                delete file.file_id
            }

            if ("name" in file && "filename" in file) {
                file.filename = file.filename || file.name
                delete file.name
            } else if ("name" in file) {
                file.filename = file.name
                delete file.name
            }

            if ("mime_type" in file && "format" in file) {
                file.format = file.format || file.mime_type
                delete file.mime_type
            } else if ("mime_type" in file) {
                file.format = file.mime_type
                delete file.mime_type
            }

            for (const key of Object.keys(file)) {
                if (file[key] === "") delete file[key]
            }
        }
    }
}

function stripFileMetadataForUrlAttachments(messages: unknown[]): void {
    for (const message of messages) {
        const messageRec = asRecord(message)
        if (!messageRec) continue
        const content = Array.isArray(messageRec.content) ? messageRec.content : null
        if (!content) continue

        for (const part of content) {
            const partRec = asRecord(part)
            if (!partRec) continue
            if (partRec.type !== "file") continue

            const file = asRecord(partRec.file)
            if (!file) continue

            const fileId = readString(file.file_id) || readString(file.fileId)
            if (!fileId || !isFileReference(fileId)) continue

            delete file.filename
            delete file.format
        }
    }
}

function applyModelAttachmentRules(
    entityData: TransformVariantInput | null | undefined,
    requestBody: Record<string, unknown>,
): void {
    const messages = Array.isArray(requestBody.messages) ? requestBody.messages : null
    if (!messages) return

    const modelName = getPromptModel(entityData, requestBody)
    if (modelName) {
        const allowed = MODEL_ATTACHMENT_ALLOWLIST.some((token) =>
            modelName.toLowerCase().includes(token),
        )
        if (allowed) return
    }

    stripFileMetadataForUrlAttachments(messages)
}

function buildRequestBody(
    mode: ExecutionMode,
    params: {
        entityData: TransformVariantInput | null | undefined
        inputRow?: Record<string, unknown>
        chatHistory?: TransformMessage[]
        requestPayload: RequestPayloadData | null | undefined
        variables: string[]
        variableValues: Record<string, string>
        entityId: string
        agConfigFallbacks?: AgConfigFallbackCandidate[]
    },
): Record<string, unknown> {
    const {
        entityData,
        inputRow,
        chatHistory,
        requestPayload,
        variables,
        variableValues,
        entityId,
        agConfigFallbacks,
    } = params

    // Build raw ag_config from requestPayload (already raw parameters)
    const payloadAgConfig = asRecord(requestPayload?.ag_config)
    const rawAgConfig =
        payloadAgConfig && Object.keys(payloadAgConfig).length > 0
            ? payloadAgConfig
            : firstNonEmptyAgConfig(agConfigFallbacks) || undefined

    const requestBody = stripAgentaMetadataDeep(
        transformToRequestBody({
            variant: (entityData || {}) as TransformVariantInput,
            ...(mode === "completion" ? {inputRow} : {}),
            ...(mode === "chat" ? {chatHistory} : {}),
            spec: requestPayload?.spec as OpenAPISpec | undefined,
            routePath: requestPayload?.routePath,
            variables,
            variableValues,
            entityId,
            isChat: mode === "chat",
            isCustom: requestPayload?.isCustom,
            appType: requestPayload?.appType || undefined,
            rawAgConfig: rawAgConfig as Record<string, unknown> | undefined,
        }),
    ) as Record<string, unknown>

    if (Array.isArray(requestBody.messages)) {
        const messages = stripEnhancedWrappers(requestBody.messages)
        requestBody.messages = Array.isArray(messages) ? messages : []
        if (Array.isArray(requestBody.messages)) {
            // Strip internal-only fields that LLM APIs reject (e.g. OpenAI)
            for (const msg of requestBody.messages) {
                const rec = msg as Record<string, unknown>
                delete rec.id
                delete rec.parentId
                delete rec.sessionId
            }
            normalizeFileMessageParts(requestBody.messages)
            applyModelAttachmentRules(entityData, requestBody)
        }
    }

    if ("repetitions" in requestBody) {
        delete requestBody.repetitions
    }

    return requestBody
}

function buildExecutionItem(
    mode: ExecutionMode,
    params: BuildExecutionItemBaseParams & {
        inputRow?: Record<string, unknown>
        chatHistory?: TransformMessage[]
    },
): ExecutionItem {
    const requestPayload = params.requestPayload || null
    const entityData = params.entityData || null

    const invocationUrlWithQuery = appendQueryParams(
        resolveInvocationUrl(params.invocationUrl, requestPayload, entityData),
        {
            application_id: readString(requestPayload?.appId),
            project_id: params.headers.Authorization
                ? readString(params.projectId || undefined)
                : undefined,
        },
    )

    // When the entity provides a pre-built request body (e.g. workflow invoke),
    // use it directly instead of building a legacy ag_config body.
    const isRawBody = !!(requestPayload as Record<string, unknown> | null)?.__rawBody
    const requestBody = isRawBody
        ? (() => {
              const {
                  __rawBody: _,
                  invocationUrl: _url,
                  ...body
              } = requestPayload as unknown as Record<string, unknown>
              // When inputValues are provided (e.g. from chain execution),
              // merge them into the raw body's inputs field.
              if (params.inputValues && Object.keys(params.inputValues).length > 0) {
                  // For workflow invoke payloads with nested `data` structure
                  // (e.g. POST /preview/workflows/invoke), populate data.inputs
                  // with all input values and data.outputs with the upstream
                  // model output so the backend template engine can resolve
                  // {{inputs}} and {{outputs}} correctly.
                  if (body.data && typeof body.data === "object") {
                      const dataObj = body.data as Record<string, unknown>
                      const iv = params.inputValues as Record<string, unknown>
                      // All fields (testcase + prediction + ground_truth) go into data.inputs
                      dataObj.inputs = iv
                      // The prediction field is the normalized upstream output —
                      // set it as data.outputs (a plain string) for template resolution.
                      if (iv.prediction !== undefined) {
                          dataObj.outputs = iv.prediction
                      }
                  }
                  body.inputs = params.inputValues
              }
              return body
          })()
        : buildRequestBody(mode, {
              entityData,
              inputRow: params.inputRow,
              chatHistory: params.chatHistory,
              requestPayload,
              variables: params.variables || [],
              variableValues: params.variableValues || {},
              entityId: params.entityId,
              agConfigFallbacks: params.agConfigFallbacks,
          })

    const references: ExecutionItemReference = {
        loadableId: params.loadableId,
        rowId: params.rowId,
        entityId: params.entityId,
        sessionId: `sess:${params.entityId}`,
        ...(params.messageId ? {messageId: params.messageId} : {}),
    }

    const invocation: ExecutionItemInvocation = {
        runId: params.runId,
        invocationUrl: invocationUrlWithQuery,
        requestBody,
        headers: params.headers || {},
        repetitions: Math.max(1, params.repetitions),
    }

    const workerPayload: WorkerRunEntityRowPayload = {
        runId: invocation.runId,
        rowId: references.rowId,
        entityId: references.entityId,
        ...(references.messageId ? {messageId: references.messageId} : {}),
        invocationUrl: invocation.invocationUrl,
        requestBody: invocation.requestBody,
        headers: invocation.headers,
        repetitions: invocation.repetitions,
    }

    return {
        id: `${params.runId}:${params.entityId}:${params.rowId}`,
        mode,
        references,
        invocation,
        workerPayload,
    }
}

// ============================================================================
// PUBLIC BUILDERS
// ============================================================================

export function buildCompletionExecutionItem(
    params: BuildCompletionExecutionItemParams,
): ExecutionItem {
    return buildExecutionItem("completion", params)
}

export function buildChatExecutionItem(params: BuildChatExecutionItemParams): ExecutionItem {
    return buildExecutionItem("chat", params)
}

// ============================================================================
// EXECUTION RESULT HANDLER
// ============================================================================

export interface HandleExecutionResultPayload {
    loadableId: string
    sessionId: string
    rowId: string
    result: unknown
}

/**
 * Unified execution result handler.
 *
 * Processes a raw API result into the appropriate state model based on mode:
 * - **Completion**: registers the result in the execution reducer.
 * - **Chat**: builds assistant/tool messages, writes to flat message model,
 *   tracks execution state, and auto-appends a blank user message.
 *
 * This is the single owner of result→state mapping. The web worker integration
 * layer should dispatch here without knowing about chat vs completion internals.
 */
export const handleExecutionResultAtom = atom(
    null,
    (get, set, payload: HandleExecutionResultPayload) => {
        const {loadableId, sessionId, rowId, result: testResult} = payload
        if (!loadableId) return

        const isChat = get(isChatModeAtom) === true

        if (isChat) {
            const results = Array.isArray(testResult) ? testResult : [testResult]
            const lastResult = results[results.length - 1]

            // Build assistant and tool messages from result
            const incoming = buildAssistantMessage(lastResult)
            const toolMessages = buildToolMessages(lastResult)
            const hasToolCalls = toolMessages.length > 0

            // Find the parent user message this response belongs to
            const flatIds = get(messageIdsAtomFamily(loadableId))
            const flatById = get(messagesByIdAtomFamily(loadableId))
            let parentUserMsgId: string | undefined
            for (let i = flatIds.length - 1; i >= 0; i--) {
                const m = flatById[flatIds[i]]
                if (m && m.sessionId === SHARED_SESSION_ID && m.role === "user") {
                    parentUserMsgId = flatIds[i]
                    break
                }
            }

            // Build assistant ChatMessage
            const assistantMsgId = generateMessageId()
            const assistantChatMsg: ChatMessage = {
                ...incoming,
                id: assistantMsgId,
                sessionId,
                ...(parentUserMsgId ? {parentId: parentUserMsgId} : {}),
            }

            // Build tool ChatMessages
            const toolChatMsgs: ChatMessage[] = toolMessages.map((tm) => ({
                ...tm,
                id: generateMessageId(),
                sessionId,
                ...(parentUserMsgId ? {parentId: parentUserMsgId} : {}),
            }))

            // Write messages to flat model
            set(addMessagesAtom, {
                loadableId,
                messages: [assistantChatMsg, ...toolChatMsgs],
            })

            // Write execution state on the assistant message
            const traceId = extractTraceIdFromPayload(testResult) ?? undefined
            set(completeMessageExecutionAtom, {
                loadableId,
                messageId: assistantMsgId,
                result: {output: testResult, traceId},
            })

            // Register completion in execution reducer (for useExecutionCell compatibility)
            set(completeRunAtom, {
                loadableId,
                stepId: parentUserMsgId ?? rowId,
                sessionId,
                result: {output: testResult},
            })

            // Auto-append blank user message if this was the last turn
            const updatedFlatIds = get(messageIdsAtomFamily(loadableId))
            const lastMsgId = updatedFlatIds[updatedFlatIds.length - 1]
            const isLastResponse =
                lastMsgId === assistantMsgId ||
                (toolChatMsgs.length > 0 && lastMsgId === toolChatMsgs[toolChatMsgs.length - 1].id)
            if (isLastResponse && !hasToolCalls) {
                set(addMessageAtom, {
                    loadableId,
                    message: {
                        id: generateMessageId(),
                        role: "user",
                        content: "",
                        sessionId: SHARED_SESSION_ID,
                    },
                })
            }

            return
        }

        // Completion mode: register result
        const completionTraceId = extractTraceIdFromPayload(testResult)
        set(completeRunAtom, {
            loadableId,
            stepId: rowId,
            sessionId,
            result: {
                output: testResult,
                traceId: completionTraceId,
            },
        })
    },
)
