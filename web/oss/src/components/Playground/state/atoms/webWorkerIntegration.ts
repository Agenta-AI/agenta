import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {hashResponse} from "@/oss/components/Playground/assets/hash"
// import removed: getTextContent (history now built via selector)
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {getAllMetadata, getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {extractInputKeysFromSchema, extractVariables} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {getJWT} from "@/oss/services/api"
import {rowVariablesAtomFamily} from "@/oss/state/generation/selectors"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily, promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import {getProjectValues} from "@/oss/state/project"
import {getSpecLazy} from "@/oss/state/variant/atoms/fetcher"

import {routerAppIdAtom} from "../../../../state/app/atoms/fetcher"
import {
    rowIdIndexAtom,
    runStatusByRowRevisionAtom,
    inputRowsByIdAtom,
    chatTurnsByIdAtom,
} from "../../../../state/generation/entities"
import {appUriInfoAtom} from "../../../../state/variant/atoms/fetcher"
import {chatHistorySelectorFamily} from "../selectors/history"
import {variableValuesSelectorFamily} from "../selectors/variables"

import {playgroundStateAtom} from "./core"
import {ensureChatSessionsForDisplayedRevisionsAtom} from "./generationMutations"
import {buildAssistantMessage, buildCompletionResponseText} from "./helpers/messageFactory"
import {pruneTurnsAfterLogicalIdMutationAtom} from "./mutations/chat/pruneTurnsAfterLogical"
import {expectedRoundByLogicalAtom} from "./orchestration/expected"
import {variantByRevisionIdAtomFamily} from "./propertySelectors"
import {revisionListAtom, displayedVariantsAtom} from "./variants"

/**
 * Web Worker Integration Atoms
 *
 * These atoms handle the integration between Jotai state management
 * and the web worker system for test execution.
 */

// Atom to store pending web worker requests
export const pendingWebWorkerRequestsAtom = atom<
    Record<
        string,
        {
            rowId: string
            variantId: string
            runId: string
            timestamp: number
        }
    >
>({})

// Set to track processed messages and prevent duplicate processing
const processedMessages = new Set<string>()
// Guard to prevent appending the follow-up user turn more than once per logical turn
const appendedNextTurnByLogical = new Set<string>()

/**
 * Resolve the effective revision id to run against.
 */
function resolveEffectiveRevisionId(
    get: any,
    requestedVariantId: string | undefined,
): string | null {
    const currentState = get(playgroundStateAtom)
    const revisions = (get(revisionListAtom) || []) as any[]
    const effectiveId =
        requestedVariantId ||
        (currentState?.metadata?.selectedVariantId as string | undefined) ||
        (revisions[0]?.id as string | undefined)
    return effectiveId || null
}

/**
 * Detect whether a row id corresponds to a chat variant (normalized-first check).
 */
function detectIsChatVariant(get: any, rowId: string): boolean {
    const turns = get(chatTurnsByIdAtom)
    if (turns && turns[rowId]) return true
    const spec = getSpecLazy()
    const appUri = get(appUriInfoAtom)
    if (spec) {
        const properties = (
            spec.paths[(appUri?.runtimePrefix || "") + (appUri?.routePath || "") + "/run"] ||
            spec.paths[(appUri?.runtimePrefix || "") + (appUri?.routePath || "") + "/test"]
        )?.post?.requestBody?.content["application/json"]?.schema?.properties
        return properties?.messages !== undefined
    }
    return false
}

/**
 * Compute variable values for a given revision, using canonical selectors.
 * Prefers row-scoped variables for completion mode.
 */
function computeVariableValues(
    get: any,
    isChatVariant: boolean,
    rowId: string,
    effectiveId: string,
): Record<string, string> {
    let variableValues: Record<string, string> = {}
    if (!isChatVariant) {
        const nodes = get(rowVariablesAtomFamily({rowId, revisionId: effectiveId})) as any[]
        for (const n of nodes || []) {
            const name = (n as any)?.key ?? (n as any)?.__id
            if (!name) continue
            const v = (n as any)?.content?.value ?? (n as any)?.value
            variableValues[name] = v !== undefined && v !== null ? String(v) : ""
        }
        if (Object.keys(variableValues).length === 0) {
            variableValues = get(variableValuesSelectorFamily({revisionId: effectiveId})) as Record<
                string,
                string
            >
        }
    } else {
        variableValues = get(variableValuesSelectorFamily({revisionId: effectiveId})) as Record<
            string,
            string
        >
    }
    if (isChatVariant) {
        // Build from normalized input rows for chat variants (per revision)
        const rowsById = get(inputRowsByIdAtom) as Record<string, any>
        for (const row of Object.values(rowsById || {})) {
            const edited = ((row as any)?.variablesByRevision || {})[effectiveId] || []
            for (const node of edited) {
                const name = (node as any)?.key ?? (node as any)?.__id
                if (!name) continue
                const v = (node as any)?.content?.value ?? (node as any)?.value
                const s = v !== undefined && v !== null ? String(v) : ""
                if (s && s.trim().length > 0) variableValues[name] = s
            }
        }

        // Fallback: if this revision has no values, borrow from baseline displayed revision
        if (Object.keys(variableValues).length === 0) {
            const displayed = (get(displayedVariantsAtom) || []) as string[]
            const baseline = displayed?.[0]
            if (baseline && baseline !== effectiveId) {
                for (const row of Object.values(rowsById || {})) {
                    const edited = ((row as any)?.variablesByRevision || {})[baseline] || []
                    for (const node of edited) {
                        const name = (node as any)?.key ?? (node as any)?.__id
                        if (!name) continue
                        const v = (node as any)?.content?.value ?? (node as any)?.value
                        const s = v !== undefined && v !== null ? String(v) : ""
                        if (s && s.trim().length > 0) variableValues[name] = s
                    }
                }
            }
        }
    }
    // Prune to allowed keys
    try {
        const flags = get(variantFlagsAtomFamily({revisionId: effectiveId})) as any
        const isCustom = !!flags?.isCustom
        let allowed = new Set<string>()
        if (isCustom) {
            const spec = getSpecLazy()
            const routePath = get(appUriInfoAtom)?.routePath
            const keys = extractInputKeysFromSchema(spec, routePath) || []
            allowed = new Set(keys as string[])
        } else {
            // Prefer prompt-derived variables; also scan live prompts content to capture immediate edits
            const promptVars = (get(promptVariablesAtomFamily(effectiveId)) || []) as string[]
            const livePrompts = (get(promptsAtomFamily(effectiveId)) || []) as any[]
            const scanned = new Set<string>()
            try {
                for (const p of livePrompts || []) {
                    const msgs = (p as any)?.messages?.value || []
                    for (const m of msgs) {
                        const content = m?.content?.value
                        if (typeof content === "string") {
                            extractVariables(content).forEach((v) => scanned.add(v))
                        } else if (Array.isArray(content)) {
                            for (const part of content) {
                                const text = part?.text?.value ?? part?.text ?? ""
                                if (typeof text === "string") {
                                    extractVariables(text).forEach((v) => scanned.add(v))
                                }
                            }
                        }
                    }
                }
            } catch {}
            allowed = new Set([...(promptVars || []), ...Array.from(scanned)])
        }
        variableValues = Object.fromEntries(
            Object.entries(variableValues || {}).filter(([k]) => allowed.has(k)),
        ) as Record<string, string>
    } catch {}
    return variableValues
}

// Atom to trigger web worker test execution
export const triggerWebWorkerTestAtom = atom(
    null,
    async (
        get,
        set,
        params: {
            rowId: string
            variantId?: string
        },
    ) => {
        const {rowId} = params
        const requestedVariantId = params.variantId

        const webWorker = (window as any).__playgroundWebWorker
        if (!webWorker) {
            return
        }
        const {postMessageToWorker, createWorkerMessage} = webWorker

        const displayed = (get(displayedVariantsAtom) || []) as string[]
        const effectiveId = resolveEffectiveRevisionId(get, requestedVariantId)
        if (!effectiveId) {
            return
        }

        // Comparison Mode: when no explicit variantId is provided and multiple revisions are displayed,
        // trigger one run per displayed revision and return early to avoid duplicate single-run.
        if (!requestedVariantId) {
            try {
                if (Array.isArray(displayed) && displayed.length > 1) {
                    for (const revId of displayed) {
                        if (revId) {
                            set(triggerWebWorkerTestAtom, {rowId, variantId: revId})
                        }
                    }
                    return
                }
            } catch {
                // best-effort only; fall through to single-run
            }
        }
        const variant = get(variantByRevisionIdAtomFamily(effectiveId)) as any
        const prompts = get(promptsAtomFamily(effectiveId))
        const promptVars = get(promptVariablesAtomFamily(effectiveId))
        // Derive custom properties (so transformToRequestBody can include them for custom workflows)
        const customProps = variant
            ? get(customPropertiesByRevisionAtomFamily(effectiveId))
            : undefined
        const currentVariant = variant
            ? ({...variant, prompts, customProperties: customProps} as any)
            : undefined
        const isChatVariant = detectIsChatVariant(get, rowId)

        // Do not gate runs on legacy generationData presence

        const runId = generateId()

        // In single-mode chat, treat any run as row re-run: prune future turns after this logical turn
        if (isChatVariant) {
            const displayed = (get(displayedVariantsAtom) || []) as string[]
            if (Array.isArray(displayed) && displayed.length === 1) {
                const turns = get(chatTurnsByIdAtom) as Record<string, any>
                const logicalId = turns?.[rowId]?.logicalTurnId as string | undefined
                if (logicalId) set(pruneTurnsAfterLogicalIdMutationAtom, logicalId)
            }
        }

        // Mark expected round for orchestrator (single run) ONLY in true single-mode (displayed.length === 1)
        if (isChatVariant) {
            const displayedNow = (get(displayedVariantsAtom) || []) as string[]
            if (Array.isArray(displayedNow) && displayedNow.length === 1) {
                const turns = get(chatTurnsByIdAtom) as Record<string, any>
                const logicalId = turns?.[rowId]?.logicalTurnId as string | undefined
                if (logicalId) {
                    const roundId = `${logicalId}:${effectiveId}:${runId}`
                    set(expectedRoundByLogicalAtom, (prev) => ({
                        ...prev,
                        [logicalId]: {
                            expectedRevIds: [effectiveId],
                            roundId,
                            origin: "single",
                        },
                    }))
                }
            }
        }

        // Update rowIdIndex with the latest revision id used for this run
        set(rowIdIndexAtom, (prev) => ({
            ...prev,
            [rowId]: {
                ...(prev[rowId] || {}),
                latestRevisionId: effectiveId,
            },
        }))

        // Store the pending request
        set(pendingWebWorkerRequestsAtom, (prev) => ({
            ...prev,
            [runId]: {
                rowId,
                variantId: effectiveId,
                runId,
                timestamp: Date.now(),
            },
        }))

        // No legacy writes; normalized run status is updated below.

        // If this is chat mode, clear the append guard so a follow-up empty user turn
        // can be appended again after this (re-)run completes. This keeps the per-logical-turn
        // de-duplication for concurrent variant results, but allows a new append per re-run.
        try {
            if (isChatVariant) {
                const turns = get(chatTurnsByIdAtom)
                const t = turns?.[rowId]
                const logicalId = t?.logicalTurnId as string | undefined
                if (logicalId && appendedNextTurnByLogical.has(logicalId)) {
                    appendedNextTurnByLogical.delete(logicalId)
                }
            }
        } catch {
            // best-effort only
        }

        // Normalized run status: mark running for (rowId, revisionId)
        set(runStatusByRowRevisionAtom, (prev) => ({
            ...prev,
            [`${rowId}:${effectiveId}`]: {isRunning: runId, resultHash: null},
        }))

        // Do NOT append a placeholder assistant message; use run status for loading UI

        // For completion mode: clear previous normalized responses to avoid bleed
        if (!isChatVariant) {
            const displayedNow = (get(displayedVariantsAtom) || []) as string[]
            set(inputRowsByIdAtom, (prev) =>
                produce(prev, (draft: any) => {
                    const row = draft?.[rowId]
                    if (!row) return
                    if (!row.responsesByRevision) row.responsesByRevision = {}
                    if (Array.isArray(displayedNow) && displayedNow.length > 1) {
                        // Comparison: reset entire map for this row to guarantee no stale buckets linger
                        row.responsesByRevision = {}
                    } else {
                        // Single: reset only for the effective revision
                        row.responsesByRevision[effectiveId] = []
                    }
                }),
            )
        }

        // Prepare web worker payload
        let inputRow, chatHistory

        if (isChatVariant) {
            // Ensure sessions exist and build history via selector
            set(ensureChatSessionsForDisplayedRevisionsAtom)
            try {
                chatHistory = (get(
                    chatHistorySelectorFamily({revisionId: effectiveId, untilTurnId: rowId}),
                ) || []) as any[]
            } catch {
                chatHistory = [] as any[]
            }

            // Optionally include variables from first normalized input row
            const inputRows = get(inputRowsByIdAtom)
            inputRow = Object.values(inputRows || {})[0]
        } else {
            // For completion mode, do not require legacy inputRow; variables come from normalized store
            inputRow = undefined as any
        }

        // Get required data for web worker
        // Use the same sources as the old middleware system
        const {projectId} = getProjectValues()
        const appId = get(routerAppIdAtom) || ""

        // Build URI info from app-level URI info and current variant's own URI
        const appUriInfo = get(appUriInfoAtom)
        const runtimePrefix = (currentVariant as any)?.uri || appUriInfo?.runtimePrefix || ""
        const uri = {
            runtimePrefix,
            routePath: appUriInfo?.routePath || "",
            status: true,
        }

        // Get JWT token and API URL for authenticated requests
        const jwt = await getJWT()
        const apiUrl = getAgentaApiUrl()

        // For normalized chat, set messageId to the turn id
        let actualMessageId: string | undefined = isChatVariant ? rowId : undefined

        // Build variable values via helper
        const variableValues = computeVariableValues(get, isChatVariant, rowId, effectiveId)
        // Variables are canonical from normalized inputs; baseline backfill removed.

        // Removed legacy generationData.inputs fallback: variables must come from normalized inputs

        const flags = get(variantFlagsAtomFamily({revisionId: effectiveId})) as any
        const workerPayload = {
            variant: currentVariant,
            runId,
            chatHistory,
            messageId: isChatVariant ? actualMessageId : undefined,
            inputRow,
            rowId,
            appId,
            uri,
            projectId,
            apiUrl,
            allMetadata: getAllMetadata(),
            headers: {
                ...(jwt
                    ? {
                          Authorization: `Bearer ${jwt}`,
                      }
                    : {}),
            },
            spec: getSpecLazy(),
            prompts,
            variables: promptVars,
            variableValues,
            revisionId: effectiveId,
            variantId: effectiveId,
            isChat: isChatVariant,
            isCustom: Boolean(flags?.isCustom),
            appType: (get(currentAppContextAtom)?.appType as any) || undefined,
        }
        postMessageToWorker(createWorkerMessage("runVariantInputRow", workerPayload))
    },
)

// Atom to handle web worker results
export const handleWebWorkerResultAtom = atom(
    null,
    (
        get,
        set,
        result: {
            type: string
            payload: {
                variant: any
                rowId: string
                result: any
                messageId?: string
                runId: string
                variantId?: string
                revisionId?: string
            }
        },
    ) => {
        if (result.type !== "runVariantInputRowResult") {
            return
        }

        const {payload} = result
        const {rowId, result: testResult, runId, variant, messageId} = payload
        // Recover variantId robustly: explicit -> embedded -> pending map -> rowIdIndex fallback
        const pending = get(pendingWebWorkerRequestsAtom) || {}
        let variantId =
            (payload as any).variantId ||
            (payload as any).revisionId ||
            (variant && (variant as any).id) ||
            pending?.[runId]?.variantId
        if (!variantId) {
            const rowIdx = get(rowIdIndexAtom) || {}
            variantId = rowIdx[rowId]?.latestRevisionId
        }

        if (!variantId) {
            return
        }

        // Create a unique message identifier for deduplication
        const messageKey = `${runId}-${rowId}-${variantId}-${messageId || "no-message"}`

        // Check if this message has already been processed
        if (processedMessages.has(messageKey)) {
            console.warn("⚠️ [WEBHOOK] Duplicate message detected, skipping:", messageKey)
            return
        }

        // Mark this message as processed
        processedMessages.add(messageKey)

        // Clean up old processed messages to prevent memory leaks (keep last 100)
        if (processedMessages.size > 100) {
            const firstKey = processedMessages.values().next().value
            processedMessages.delete(firstKey)
        }

        // Remove from pending requests
        set(pendingWebWorkerRequestsAtom, (prev) => {
            const newPending = {...prev}
            delete newPending[runId]
            return newPending
        })

        // Update normalized state directly for chat; keep completion legacy block for non-chat
        const isChatVariant = detectIsChatVariant(get, rowId)

        if (isChatVariant) {
            // Normalize error shape to include trace tree and message, aligning with main branch
            let normalizedResult = testResult
            if (testResult?.error) {
                const tree = testResult?.metadata?.rawError?.detail?.tree
                const trace = tree?.nodes?.[0]
                const messageStr = trace?.status?.message ?? String(testResult.error)
                normalizedResult = {
                    response: {data: messageStr, tree},
                    error: messageStr,
                    metadata: testResult?.metadata,
                }
            }
            const responseHash = hashResponse(normalizedResult)
            set(runStatusByRowRevisionAtom, (prev) => ({
                ...prev,
                [`${rowId}:${variantId}`]: {isRunning: false, resultHash: responseHash},
            }))

            set(chatTurnsByIdAtom, (prev) =>
                produce(prev, (draft: any) => {
                    const turnId = messageId || rowId
                    if (!turnId) return
                    const turn = draft[turnId]
                    if (!turn) return
                    if (!turn.assistantMessageByRevision) turn.assistantMessageByRevision = {}
                    // Build Enhanced assistant message using the same schema as userMessage
                    const metaId = turn?.userMessage?.__metadata as string | undefined
                    const messageSchema = metaId ? getMetadataLazy(metaId) : undefined
                    let incoming: any
                    incoming = buildAssistantMessage(messageSchema, testResult)
                    turn.assistantMessageByRevision[variantId] = incoming
                }),
            )

            // Do not append here; orchestrator will append when appropriate

            // Reinforce index
            set(rowIdIndexAtom, (prev) => {
                const entry = prev[rowId] || {}
                const existingTurnIds = entry.chatTurnIds || []
                const tid = messageId || rowId
                const nextTurnIds = tid
                    ? Array.from(new Set([...existingTurnIds, tid]))
                    : existingTurnIds
                return {
                    ...prev,
                    [rowId]: {
                        ...entry,
                        latestRevisionId: variantId,
                        chatTurnIds: nextTurnIds,
                    },
                }
            })

            return
        } else {
            // COMPLETION MODE: write via shared helper
            const responseHash = buildCompletionResponseText(testResult)

            // Persist normalizedResponses for this row+revision so comparison view can resolve hashes
            set(inputRowsByIdAtom, (prev) =>
                produce(prev, (draft: any) => {
                    const row = draft?.[rowId]
                    if (!row) return
                    if (!row.responsesByRevision) row.responsesByRevision = {}
                    const arr: any[] = Array.isArray(row.responsesByRevision[variantId])
                        ? row.responsesByRevision[variantId]
                        : []

                    const exists = arr.some((m: any) => m?.content?.value === responseHash)
                    if (!exists) {
                        // push a normalized assistant message referencing the response hash
                        arr.push({
                            __id: generateId(),
                            role: "assistant",
                            content: {value: responseHash},
                        })
                    }
                    row.responsesByRevision[variantId] = arr
                }),
            )
            set(runStatusByRowRevisionAtom, (prev) => ({
                ...prev,
                [`${rowId}:${variantId}`]: {isRunning: false, resultHash: responseHash},
            }))
        }

        const queryClient = get(queryClientAtom)
        queryClient.invalidateQueries({queryKey: ["traces"]})
    },
)

/**
 * Explicit mapping: for a given logical chat turn (lt-...) and revision, store the exact
 * session-specific turn id (rowId) used for the most recent run. This removes ambiguity
 * when resolving which `${rowId}:${revisionId}` key to read from runStatus.
 */
export const lastRunTurnForVariantAtomFamily = atomFamily(
    (p: {logicalId: string; revisionId: string}) => {
        const base = atom<string | null>(null)
        return atom(
            (get) => get(base),
            (get, set, next: string | null) => set(base, next),
        )
    },
)

export const setLastRunTurnForVariantAtom = atom(
    null,
    (get, set, params: {logicalId: string; revisionId: string; rowId: string}) => {
        const {logicalId, revisionId, rowId} = params
        set(lastRunTurnForVariantAtomFamily({logicalId, revisionId}), rowId)
    },
)
