import {getAllMetadata} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {generateId} from "@agenta/shared/utils"
import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {hashResponse} from "@/oss/components/Playground/assets/hash"
import {appChatModeAtom, generationRowIdsAtom} from "@/oss/components/Playground/state/atoms"
import {generationInputRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {
    playgroundAppUriInfoAtom,
    playgroundAppSchemaAtom,
} from "@/oss/components/Playground/state/atoms/playgroundAppAtoms"
import {
    displayedVariantsAtom,
    revisionListAtom,
} from "@/oss/components/Playground/state/atoms/variants"
import {
    extractValueByMetadata,
    stripAgentaMetadataDeep,
    stripEnhancedWrappers,
} from "@/oss/lib/shared/variant/valueHelpers"
import {getJWT} from "@/oss/services/api"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {
    chatTurnIdsAtom,
    chatTurnsByIdAtom,
    // chatTurnsByIdAtom, // Moved
    chatTurnsByIdFamilyAtom,
    inputRowsByIdAtom,
    inputRowsByIdFamilyAtom,
    messageSchemaMetadataAtom,
    rowIdIndexAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"
import {rowVariablesAtomFamily} from "@/oss/state/generation/selectors"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {repetitionCountAtom} from "@/oss/state/newPlayground/generation/options"
import {
    loadingByRowRevisionAtomFamily,
    responseByRowRevisionAtomFamily,
} from "@/oss/state/newPlayground/generation/runtime"
import {
    buildAssistantMessage,
    buildCompletionResponseText,
    buildToolMessages,
} from "@/oss/state/newPlayground/helpers/messageFactory"
import {
    moleculeBackedCustomPropertiesAtomFamily,
    moleculeBackedPromptsAtomFamily,
    moleculeBackedVariantAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"
import {variableValuesSelectorFamily} from "@/oss/state/newPlayground/selectors/variables"
import {getProjectValues} from "@/oss/state/project"
// (runnableBridge imported above with external deps)

import {selectedAppIdAtom} from "../../app"

// Atom to store pending web worker requests
export const pendingWebWorkerRequestsAtom = atom<
    Record<
        string,
        {
            rowId: string
            variantId: string
            runId: string
            timestamp: number
            preserveExistingAssistant?: boolean
            previousStatus?: {isRunning?: string | false; resultHash?: string | null}
        }
    >
>({})

export const ignoredWebWorkerRunIdsAtom = atom<Record<string, true>>({})

const cloneNodeDeep = (value: any) => {
    if (value === null || value === undefined) return value
    try {
        return JSON.parse(JSON.stringify(value))
    } catch {
        return value
    }
}

const _scrubLargeFields = (value: any): any => {
    if (Array.isArray(value)) {
        return value.map((item) => _scrubLargeFields(item))
    }
    if (value && typeof value === "object") {
        const next: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(value)) {
            next[key] = _scrubLargeFields(val)
        }
        return next
    }
    if (typeof value === "string" && value.startsWith("data:") && value.length > 120) {
        return `${value.slice(0, 60)}...(${value.length})`
    }
    return value
}

function resolveEffectiveRevisionId(
    get: any,
    requestedRevisionId: string | undefined,
): string | null {
    const revisions = (get(revisionListAtom) || []) as any[]
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    const effectiveId =
        requestedRevisionId ||
        (Array.isArray(displayed) && displayed.length > 0
            ? (displayed[0] as string | undefined)
            : undefined) ||
        (revisions[0]?.id as string | undefined)
    return effectiveId || null
}

function detectIsChatVariant(get: any, _rowId: string): boolean {
    // Use the same chat mode detection as the rendering layer
    // instead of manually parsing raw OpenAPI paths which can miss the messages schema.
    return Boolean(get(appChatModeAtom))
}

interface ResolvedVariableKeys {
    ordered: string[]
    set: Set<string>
}

function computeVariableValues(
    get: any,
    isChatVariant: boolean,
    rowId: string,
    effectiveId: string,
    resolvedKeys?: ResolvedVariableKeys,
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
        const rowsById = get(inputRowsByIdAtom) as Record<string, any>
        for (const row of Object.values(rowsById || {})) {
            const edited = (row as any)?.variables || []
            for (const node of edited) {
                const name = (node as any)?.key ?? (node as any)?.__id
                if (!name) continue
                const v = (node as any)?.content?.value ?? (node as any)?.value
                const s = v !== undefined && v !== null ? String(v) : ""
                if (s && s.trim().length > 0) variableValues[name] = s
            }
        }
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
    try {
        const allowed = resolvedKeys ?? resolveAllowedVariableKeys(get, effectiveId)
        if (allowed.ordered.length > 0) {
            const filtered: Record<string, string> = {}
            for (const key of allowed.ordered) {
                const value = variableValues[key]
                filtered[key] = value !== undefined && value !== null ? String(value) : ""
            }
            return filtered
        }

        return Object.fromEntries(
            Object.entries(variableValues || {}).filter(([k]) => allowed.set.has(k)),
        ) as Record<string, string>
    } catch {}
    return variableValues
}

// Resolve the set of allowed variable keys for a given revision
function resolveAllowedVariableKeys(get: any, revisionId: string): ResolvedVariableKeys {
    // Prefer runnableBridge input ports (single source of truth)
    const ports = (get(runnableBridge.inputPorts(revisionId)) || []) as {key?: string}[]
    const ordered = ports.map((p) => p?.key).filter((k): k is string => !!k)
    if (ordered.length > 0) {
        return {ordered, set: new Set(ordered)}
    }

    // Fallback to prompt variables if bridge input ports are unavailable
    const promptVars = (get(promptVariablesAtomFamily(revisionId)) || []) as string[]
    const keys = (promptVars || []).filter((k) => typeof k === "string" && k.length > 0)
    return {ordered: keys, set: new Set(keys)}
}

export const triggerWebWorkerTestAtom = atom(
    null,
    async (get, set, params: {rowId: string; revisionId?: string; messageId?: string}) => {
        const {rowId} = params
        const requestedRevisionId = params.revisionId
        const messageId = params.messageId

        const webWorker = (window as any).__playgroundWebWorker
        if (!webWorker) return
        const {postMessageToWorker, createWorkerMessage} = webWorker

        const displayed = (get(displayedVariantsAtom) || []) as string[]
        const effectiveId = resolveEffectiveRevisionId(get, requestedRevisionId)
        if (!effectiveId) return

        // Derive logicalId from provided rowId (session id: turn-<rev>-<logicalId> or logical id itself)
        const sessionMatch = /^turn-([^-]+)-(lt-.+)$/.exec(String(rowId))
        const logicalIdFromRow =
            sessionMatch?.[2] || (String(rowId).startsWith("lt-") ? String(rowId) : "")

        if (!requestedRevisionId) {
            if (Array.isArray(displayed) && displayed.length > 1) {
                const lid = logicalIdFromRow || String(rowId)
                for (const revId of displayed) {
                    if (!revId) continue
                    const rid = `turn-${revId}-${lid}`
                    set(triggerWebWorkerTestAtom, {rowId: rid, revisionId: revId})
                }
                return
            }
        }

        // Use molecule-backed atoms for single source of truth (includes draft state)
        const variant = get(moleculeBackedVariantAtomFamily(effectiveId)) as any
        const prompts = get(moleculeBackedPromptsAtomFamily(effectiveId))
        // const promptVars = get(promptVariablesAtomFamily(effectiveId))
        const customProps = variant
            ? get(moleculeBackedCustomPropertiesAtomFamily(effectiveId))
            : undefined
        const currentVariant = variant
            ? ({...variant, prompts, customProperties: customProps} as any)
            : undefined
        const isChatVariant = detectIsChatVariant(get, rowId)

        const runId = generateId()

        // Mark active revision for this row so selectors resolve consistently during the run
        set(rowIdIndexAtom, (prev) => ({
            ...prev,
            [rowId]: {...(prev[rowId] || {}), latestRevisionId: effectiveId},
        }))

        // Mark loading + running for UI feedback (chat and completion)
        const currentStatusMap = get(runStatusByRowRevisionAtom) as Record<
            string,
            {isRunning?: string | false; resultHash?: string | null}
        >
        const previousStatusEntry = currentStatusMap?.[`${rowId}:${effectiveId}`]

        set(runStatusByRowRevisionAtom, (prev) => ({
            ...prev,
            [`${rowId}:${effectiveId}`]: {isRunning: runId, resultHash: null},
        }))
        set(loadingByRowRevisionAtomFamily({rowId, revisionId: effectiveId}), true)

        const turnsMap = get(chatTurnsByIdAtom) as Record<string, any>
        const sourceTurn = turnsMap?.[rowId]
        const existingAssistantNode = sourceTurn?.assistantMessageByRevision?.[effectiveId] ?? null
        const existingToolResponses = sourceTurn?.toolResponsesByRevision?.[effectiveId]
        const preserveExistingAssistant =
            !messageId &&
            (existingAssistantNode !== null && existingAssistantNode !== undefined
                ? true
                : Array.isArray(existingToolResponses) && existingToolResponses.length > 0)

        set(pendingWebWorkerRequestsAtom, (prev) => ({
            ...prev,
            [runId]: {
                rowId,
                variantId: effectiveId,
                runId,
                timestamp: Date.now(),
                preserveExistingAssistant,
                previousStatus: previousStatusEntry,
            },
        }))

        const allMetadata = getAllMetadata()

        const allowedKeys = resolveAllowedVariableKeys(get, effectiveId)

        let inputRow, chatHistory: any
        if (isChatVariant) {
            const allTurnIds = get(generationRowIdsAtom)
            const turnindex = allTurnIds.indexOf(rowId)
            const turnHistoryIds = allTurnIds.slice(0, turnindex + 1)
            const historyTurns = turnHistoryIds.map((id) => get(chatTurnsByIdAtom)[id])

            chatHistory = historyTurns
                .map((t, _historyIdx) => {
                    const x = []
                    if (t.userMessage) {
                        x.push(extractValueByMetadata(t.userMessage, allMetadata))
                    }
                    if (t.assistantMessageByRevision?.[effectiveId]) {
                        x.push(
                            extractValueByMetadata(
                                t.assistantMessageByRevision[effectiveId],
                                allMetadata,
                            ),
                        )
                        const toolMessages = t.toolResponsesByRevision?.[effectiveId]
                        if (Array.isArray(toolMessages) && toolMessages.length > 0) {
                            for (const toolMsg of toolMessages) {
                                try {
                                    const y = get(messageSchemaMetadataAtom) as any
                                    x.push(
                                        extractValueByMetadata(toolMsg, {
                                            [toolMsg.__metadata]: y,
                                        }),
                                    )
                                } catch (err) {
                                    x.push({
                                        role: "tool",
                                        content:
                                            toolMsg?.content?.value ??
                                            toolMsg?.content ??
                                            toolMsg?.response ??
                                            "",
                                    })
                                }
                            }
                        }
                    }
                    return x
                })
                .flat()
                .filter(Boolean)
        }

        const sanitizedChatHistory = stripEnhancedWrappers(
            stripAgentaMetadataDeep(chatHistory),
        ) as any[]
        const sanitizedPrompts = stripAgentaMetadataDeep(prompts)

        inputRow = (() => {
            const rowIds = get(generationInputRowIdsAtom) as string[]
            if (!Array.isArray(rowIds) || rowIds.length === 0) return undefined
            // Prefer the requested rowId when present; fallback to first
            const rid = rowIds.includes(rowId) ? rowId : rowIds[0]
            const row = get(inputRowsByIdFamilyAtom(rid)) as any
            const sharedVars = (row?.variables || []) as any[]
            const revVars = (((row || {}).variablesByRevision || {})[effectiveId] || []) as any[]
            // Merge shared + revision-specific, with revision-specific overriding when duplicate keys
            const mergedByKey = new Map<string, any>()
            for (const node of sharedVars || []) {
                const k = (node?.key ?? node?.__id) as string | undefined
                if (!k) continue
                mergedByKey.set(k, node)
            }
            for (const node of revVars || []) {
                const k = (node?.key ?? node?.__id) as string | undefined
                if (!k) continue
                mergedByKey.set(k, node)
            }
            // Filter to allowed keys for the active revision
            const enhanced: Record<string, any> = {__id: rid}
            const allowedNames = allowedKeys.ordered.length
                ? allowedKeys.ordered
                : Array.from(allowedKeys.set)
            for (const name of allowedNames) {
                const node = mergedByKey.get(name)
                const v = node?.content?.value ?? node?.value
                enhanced[name] = {value: v !== undefined && v !== null ? String(v) : ""}
            }
            return enhanced
        })()

        const {projectId} = getProjectValues() || ({} as any)
        const appId = get(selectedAppIdAtom)
        const {appType} = (get(currentAppContextAtom) as any) || {}
        const jwt = await getJWT()
        const uri = get(playgroundAppUriInfoAtom) || ({} as any)
        const rawRepetitions = get(repetitionCountAtom)
        const repetitions = Array.isArray(displayed) && displayed.length > 1 ? 1 : rawRepetitions

        // Build headers for worker fetch
        const headers: Record<string, string> = {}
        if (jwt) headers.Authorization = `Bearer ${jwt}`

        // Compose worker payload in the schema it expects
        const payload = {
            variant: currentVariant,
            allMetadata: allMetadata,
            inputRow,
            rowId,
            messageId,
            repetition: repetitions, // Keep singular key if worker expects it, or use valid key
            repetitions, // Send both or specific one
            appId,
            uri: {
                runtimePrefix: uri?.runtimePrefix,
                routePath: uri?.routePath,
                status: uri?.status,
            },
            headers,
            projectId,
            chatHistory: sanitizedChatHistory,
            spec: get(playgroundAppSchemaAtom),
            runId,
            prompts: sanitizedPrompts,
            // variables: promptVars,
            variables: allowedKeys.ordered,
            variableValues: computeVariableValues(
                get,
                isChatVariant,
                rowId,
                effectiveId,
                allowedKeys,
            ),
            revisionId: effectiveId,
            variantId: effectiveId,
            isChat: isChatVariant,
            appType,
        }
        postMessageToWorker(createWorkerMessage("runVariantInputRow", payload))
    },
)

export const handleWebWorkerResultAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            rowId: string
            variantId: string
            runId: string
            result?: any
            error?: any
            messageId?: string
        },
    ) => {
        const {rowId, variantId, runId, result: testResult, error, messageId} = payload

        const pendingRequests = get(pendingWebWorkerRequestsAtom)
        const pendingEntry = pendingRequests?.[runId]
        set(pendingWebWorkerRequestsAtom, (prev) => {
            const {[runId]: _removed, ...rest} = prev
            return rest
        })

        const ignored = get(ignoredWebWorkerRunIdsAtom)
        if (runId && ignored?.[runId]) {
            set(ignoredWebWorkerRunIdsAtom, (prev) => {
                const {[runId]: _omit, ...rest} = prev
                return rest
            })
            set(loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}), false)
            return
        }

        if (error && !testResult) {
            set(runStatusByRowRevisionAtom, (prev) => ({
                ...prev,
                [`${rowId}:${variantId}`]: {isRunning: false, resultHash: null},
            }))
            set(loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}), false)
            return
        }

        const isChat = detectIsChatVariant(get, rowId)
        const preserveExistingAssistant =
            Boolean(pendingEntry?.preserveExistingAssistant) && !messageId
        const previousStatus = pendingEntry?.previousStatus

        if (isChat) {
            // Check if testResult is array (repetitions > 1)
            // For Chat, currently we only support visualizing the LAST result in the main chat flow
            // OR we need to figure out how to show multiple.
            // For now: if array, take the last one for the chat history update.
            // The Atom `responseByRowRevisionAtomFamily` will store the full array.

            const results = Array.isArray(testResult) ? testResult : [testResult]
            const lastResult = results[results.length - 1] // Use last for chat history

            let normalizedResult = lastResult
            if (lastResult?.error) {
                const tree = lastResult?.metadata?.rawError?.detail?.tree
                const trace = tree?.nodes?.[0]
                const messageStr = trace?.status?.message ?? String(lastResult.error)
                normalizedResult = {
                    response: {data: messageStr, tree},
                    error: messageStr,
                    metadata: lastResult?.metadata,
                }
            }
            const responseHash = hashResponse(normalizedResult)
            const writeKey = String(rowId)
            let targetRowId = writeKey

            if (preserveExistingAssistant) {
                const turnsMap = get(chatTurnsByIdAtom) as Record<string, any>
                const baseTurn = turnsMap?.[writeKey]
                if (baseTurn) {
                    const forkId = `lt-${generateId()}`
                    const sessionId =
                        baseTurn.sessionId || (variantId ? `session-${variantId}` : `session-`)

                    const assistantClone = (() => {
                        const existing = cloneNodeDeep(
                            baseTurn.assistantMessageByRevision,
                        ) as Record<string, any>
                        const map = existing && typeof existing === "object" ? existing : {}
                        map[variantId] = null
                        return map
                    })()

                    let toolResponsesClone: Record<string, any[] | null> | undefined
                    if (baseTurn.toolResponsesByRevision) {
                        toolResponsesClone = {}
                        for (const [revId, nodes] of Object.entries(
                            baseTurn.toolResponsesByRevision,
                        )) {
                            if (revId === variantId) continue
                            if (Array.isArray(nodes)) {
                                toolResponsesClone[revId] = nodes.map((n) => cloneNodeDeep(n))
                            } else if (nodes) {
                                toolResponsesClone[revId] = cloneNodeDeep(nodes) as any
                            }
                        }
                        if (toolResponsesClone && Object.keys(toolResponsesClone).length === 0)
                            toolResponsesClone = undefined
                    }

                    const forkTurn: any = {
                        id: forkId,
                        sessionId,
                        userMessage: null,
                        assistantMessageByRevision: assistantClone,
                        meta: cloneNodeDeep(baseTurn.meta) || {},
                    }
                    if (toolResponsesClone) forkTurn.toolResponsesByRevision = toolResponsesClone

                    set(chatTurnsByIdAtom, (prev) => ({...(prev || {}), [forkId]: forkTurn}))
                    set(chatTurnIdsAtom, (prev) => {
                        const list = prev || []
                        const position = list.indexOf(writeKey)
                        if (position === -1) return [...list, forkId]
                        return [...list.slice(0, position + 1), forkId, ...list.slice(position + 1)]
                    })

                    targetRowId = forkId
                }
            }

            let hasToolCalls = false
            set(chatTurnsByIdFamilyAtom(targetRowId), (draft: any) => {
                if (!draft) return
                if (!draft.assistantMessageByRevision) draft.assistantMessageByRevision = {}
                // const metaId = draft?.userMessage?.__metadata as string | undefined
                const messageSchema = get(messageSchemaMetadataAtom)
                // metaId ? getMetadataLazy(metaId) : undefined
                const incoming = buildAssistantMessage(messageSchema, lastResult) || {}
                const toolMessages = buildToolMessages(messageSchema, lastResult)
                const existingToolMessages = draft?.toolResponsesByRevision?.[variantId] ?? null
                const hasExistingToolResponses =
                    Array.isArray(existingToolMessages) && existingToolMessages.length > 0
                const hasNewToolCalls = Array.isArray(toolMessages) && toolMessages.length > 0
                draft.assistantMessageByRevision[variantId] = incoming

                if (hasNewToolCalls) {
                    if (!draft.toolResponsesByRevision) draft.toolResponsesByRevision = {}
                    draft.toolResponsesByRevision[variantId] = toolMessages
                } else if (!hasExistingToolResponses && draft?.toolResponsesByRevision) {
                    if (variantId in draft.toolResponsesByRevision) {
                        delete draft.toolResponsesByRevision[variantId]
                    }
                    if (Object.keys(draft.toolResponsesByRevision).length === 0) {
                        delete draft.toolResponsesByRevision
                    }
                }

                hasToolCalls = hasNewToolCalls
            })

            set(loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}), false)
            if (targetRowId !== writeKey) {
                set(
                    loadingByRowRevisionAtomFamily({rowId: targetRowId, revisionId: variantId}),
                    false,
                )
            }

            set(runStatusByRowRevisionAtom, (prev) => {
                const next = {...prev}
                next[`${targetRowId}:${variantId}`] = {isRunning: false, resultHash: responseHash}
                if (preserveExistingAssistant && targetRowId !== writeKey) {
                    next[`${writeKey}:${variantId}`] = {
                        isRunning: false,
                        resultHash:
                            previousStatus && previousStatus.resultHash !== undefined
                                ? previousStatus.resultHash
                                : null,
                    }
                }
                return next
            })

            set(
                responseByRowRevisionAtomFamily({rowId: targetRowId, revisionId: variantId}),
                testResult as any, // Store FULL result (array or object)
            )

            // Append a new turn id once when the handled rowId is currently last in chatTurnIdsAtom
            const ids = (get(chatTurnIdsAtom) || []) as string[]
            const idx = ids.indexOf(String(targetRowId))
            const isLast = idx >= 0 && idx === ids.length - 1
            if (isLast && !hasToolCalls) {
                set(chatTurnIdsAtom, (prev) => [...(prev || []), `lt-${generateId()}`])
            }

            return
        }

        const results = Array.isArray(testResult) ? testResult : [testResult]
        // Calculate hash for ALL results? Or key off the first/last?
        // Let's use the last one for the "status" hash to show completion.
        const lastResult = results[results.length - 1]
        const responseHash = buildCompletionResponseText(lastResult)

        set(inputRowsByIdAtom, (prev) =>
            produce(prev, (draft: any) => {
                const row = draft?.[rowId]
                if (!row) return
                if (!row.responsesByRevision) row.responsesByRevision = {}
                const arr: any[] = Array.isArray(row.responsesByRevision[variantId])
                    ? row.responsesByRevision[variantId]
                    : []

                // For completions, we might want to store all hashes?
                // Existing logic pushes a single "responseHash".
                // If we have multiple repetitions, maybe we push multiple?
                // Let's iterate.
                for (const res of results) {
                    const hash = buildCompletionResponseText(res)
                    const exists = arr.some((m: any) => m?.content?.value === hash)
                    if (!exists && hash) {
                        arr.push({
                            __id: generateId(),
                            role: "assistant",
                            content: {value: hash},
                        })
                    }
                }

                row.responsesByRevision[variantId] = arr
            }),
        )
        set(runStatusByRowRevisionAtom, (prev) => ({
            ...prev,
            [`${rowId}:${variantId}`]: {isRunning: false, resultHash: responseHash},
        }))
        set(loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}), false)
        console.debug("[WW] completion result", {rowId, variantId, count: results.length})
        set(responseByRowRevisionAtomFamily({rowId, revisionId: variantId}), testResult as any)
        const queryClient = get(queryClientAtom)
        queryClient.invalidateQueries({queryKey: ["tracing"]})
    },
)

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
