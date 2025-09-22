import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {hashResponse} from "@/oss/components/Playground/assets/hash"
import {generationRowIdsAtom} from "@/oss/components/Playground/state/atoms"
import {generationInputRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms/propertySelectors"
import {
    revisionListAtom,
    displayedVariantsAtom,
} from "@/oss/components/Playground/state/atoms/variants"
import {getAllMetadata, getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {extractInputKeysFromSchema, extractVariables} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {extractValueByMetadata} from "@/oss/lib/shared/variant/valueHelpers"
import {getJWT} from "@/oss/services/api"
import {
    rowIdIndexAtom,
    runStatusByRowRevisionAtom,
    inputRowsByIdAtom,
    chatTurnsByIdAtom,
    inputRowsByIdFamilyAtom,
    chatTurnsByIdFamilyAtom,
    inputRowIdsAtom,
    chatTurnIdsAtom,
    messageSchemaMetadataAtom,
} from "@/oss/state/generation/entities"
import {inputRowAtomFamily, rowVariablesAtomFamily} from "@/oss/state/generation/selectors"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily, promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {
    responseByRowRevisionAtomFamily,
    loadingByRowRevisionAtomFamily,
} from "@/oss/state/newPlayground/generation/runtime"
import {
    buildAssistantMessage,
    buildCompletionResponseText,
    buildToolMessages,
    buildUserMessage,
} from "@/oss/state/newPlayground/helpers/messageFactory"
import {variableValuesSelectorFamily} from "@/oss/state/newPlayground/selectors/variables"
import {getProjectValues} from "@/oss/state/project"
import {getSpecLazy, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

// Atom to store pending web worker requests
export const pendingWebWorkerRequestsAtom = atom<
    Record<string, {rowId: string; variantId: string; runId: string; timestamp: number}>
>({})

export const ignoredWebWorkerRunIdsAtom = atom<Record<string, true>>({})

function resolveEffectiveRevisionId(
    get: any,
    requestedVariantId: string | undefined,
): string | null {
    const revisions = (get(revisionListAtom) || []) as any[]
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    const effectiveId =
        requestedVariantId ||
        (Array.isArray(displayed) && displayed.length > 0
            ? (displayed[0] as string | undefined)
            : undefined) ||
        (revisions[0]?.id as string | undefined)
    return effectiveId || null
}

function detectIsChatVariant(get: any, rowId: string): boolean {
    const spec = getSpecLazy()
    const appUri = get(appUriInfoAtom)
    if (spec) {
        const properties = (
            spec.paths[(appUri?.routePath || "") + "/run"] ||
            spec.paths[(appUri?.routePath || "") + "/test"]
        )?.post?.requestBody?.content["application/json"]?.schema?.properties
        return properties?.messages !== undefined
    }
    return false
}

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
        const allowed = resolveAllowedVariableKeys(get, effectiveId)
        variableValues = Object.fromEntries(
            Object.entries(variableValues || {}).filter(([k]) => allowed.has(k)),
        ) as Record<string, string>
    } catch {}
    return variableValues
}

// Resolve the set of allowed variable keys for a given revision
function resolveAllowedVariableKeys(get: any, revisionId: string): Set<string> {
    const flags = get(variantFlagsAtomFamily({revisionId})) as any
    const isCustom = !!flags?.isCustom
    if (isCustom) {
        const spec = getSpecLazy()
        const routePath = get(appUriInfoAtom)?.routePath
        const keys = extractInputKeysFromSchema(spec, routePath) || []
        return new Set(keys as string[])
    }
    const promptVars = (get(promptVariablesAtomFamily(revisionId)) || []) as string[]
    const livePrompts = (get(promptsAtomFamily(revisionId)) || []) as any[]
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
                        if (typeof text === "string")
                            extractVariables(text).forEach((v) => scanned.add(v))
                    }
                }
            }
        }
    } catch {}
    return new Set([...(promptVars || []), ...Array.from(scanned)])
}

export const triggerWebWorkerTestAtom = atom(
    null,
    async (get, set, params: {rowId: string; variantId?: string; messageId?: string}) => {
        const {rowId} = params
        const requestedVariantId = params.variantId
        const messageId = params.messageId

        const webWorker = (window as any).__playgroundWebWorker
        if (!webWorker) return
        const {postMessageToWorker, createWorkerMessage} = webWorker

        const displayed = (get(displayedVariantsAtom) || []) as string[]
        const effectiveId = resolveEffectiveRevisionId(get, requestedVariantId)
        if (!effectiveId) return

        // Derive logicalId from provided rowId (session id: turn-<rev>-<logicalId> or logical id itself)
        const sessionMatch = /^turn-([^-]+)-(lt-.+)$/.exec(String(rowId))
        const logicalIdFromRow =
            sessionMatch?.[2] || (String(rowId).startsWith("lt-") ? String(rowId) : "")

        if (!requestedVariantId) {
            if (Array.isArray(displayed) && displayed.length > 1) {
                const lid = logicalIdFromRow || String(rowId)
                for (const revId of displayed) {
                    if (!revId) continue
                    const rid = `turn-${revId}-${lid}`
                    set(triggerWebWorkerTestAtom, {rowId: rid, variantId: revId})
                }
                return
            }
        }

        const variant = get(variantByRevisionIdAtomFamily(effectiveId)) as any
        const prompts = get(promptsAtomFamily(effectiveId))
        // const promptVars = get(promptVariablesAtomFamily(effectiveId))
        const customProps = variant
            ? get(customPropertiesByRevisionAtomFamily(effectiveId))
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
        set(runStatusByRowRevisionAtom, (prev) => ({
            ...prev,
            [`${rowId}:${effectiveId}`]: {isRunning: runId, resultHash: null},
        }))
        set(loadingByRowRevisionAtomFamily({rowId, revisionId: effectiveId}), true)

        set(pendingWebWorkerRequestsAtom, (prev) => ({
            ...prev,
            [runId]: {rowId, variantId: effectiveId, runId, timestamp: Date.now()},
        }))

        const allMetadata = getAllMetadata()

        let inputRow, chatHistory: any
        if (isChatVariant) {
            const allTurnIds = get(generationRowIdsAtom)
            const turnindex = allTurnIds.indexOf(rowId)
            const turnHistoryIds = allTurnIds.slice(0, turnindex + 1)
            const historyTurns = turnHistoryIds.map((id) => get(chatTurnsByIdAtom)[id])

            chatHistory = historyTurns
                .map((t) => {
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
            const allowed = resolveAllowedVariableKeys(get, effectiveId)
            const enhanced: Record<string, any> = {__id: rid}
            for (const [name, node] of mergedByKey.entries()) {
                if (!allowed.has(name)) continue
                const v = (node as any)?.content?.value ?? (node as any)?.value
                enhanced[name] = {value: v !== undefined && v !== null ? String(v) : ""}
            }
            return enhanced
        })()

        const {projectId} = getProjectValues() || ({} as any)
        const {appId, appType} = get(currentAppContextAtom) || ({} as any)
        const jwt = await getJWT()
        const uri = get(appUriInfoAtom) || ({} as any)

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
            appId,
            uri: {
                runtimePrefix: uri?.runtimePrefix,
                routePath: uri?.routePath,
                status: uri?.status,
            },
            headers,
            projectId,
            chatHistory,
            spec: getSpecLazy(),
            runId,
            prompts,
            // variables: promptVars,
            variableValues: computeVariableValues(get, isChatVariant, rowId, effectiveId),
            revisionId: effectiveId,
            variantId: effectiveId,
            isChat: isChatVariant,
            isCustom: get(variantFlagsAtomFamily({revisionId: effectiveId}))?.isCustom || false,
            appType,
        }
        console.debug("[WW] post runVariantInputRow", {
            rowId,
            variantId: effectiveId,
            isChatVariant,
            hasJwt: Boolean(jwt),
        })
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

        const updateStatus = (responseHash: string | null) =>
            set(runStatusByRowRevisionAtom, (prev) => ({
                ...prev,
                [`${rowId}:${variantId}`]: {isRunning: false, resultHash: responseHash},
            }))

        if (error && !testResult) {
            updateStatus(null)
            set(loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}), false)
            return
        }

        const isChat = detectIsChatVariant(get, rowId)

        if (isChat) {
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
            updateStatus(responseHash)
            set(loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}), false)
            set(
                responseByRowRevisionAtomFamily({rowId, revisionId: variantId}),
                normalizedResult as any,
            )
            const writeKey = String(rowId)
            let hasToolCalls = false
            set(chatTurnsByIdFamilyAtom(writeKey), (draft: any) => {
                if (!draft) return
                if (!draft.assistantMessageByRevision) draft.assistantMessageByRevision = {}
                // const metaId = draft?.userMessage?.__metadata as string | undefined
                const messageSchema = get(messageSchemaMetadataAtom)
                // metaId ? getMetadataLazy(metaId) : undefined
                const incoming = buildAssistantMessage(messageSchema, testResult) || {}
                const toolMessages = buildToolMessages(messageSchema, testResult)
                hasToolCalls = Array.isArray(toolMessages) && toolMessages.length > 0
                draft.assistantMessageByRevision[variantId] = incoming

                if (hasToolCalls) {
                    if (!draft.toolResponsesByRevision) draft.toolResponsesByRevision = {}
                    draft.toolResponsesByRevision[variantId] = toolMessages
                } else if (draft?.toolResponsesByRevision) {
                    if (variantId in draft.toolResponsesByRevision)
                        delete draft.toolResponsesByRevision[variantId]
                    if (Object.keys(draft.toolResponsesByRevision).length === 0)
                        delete draft.toolResponsesByRevision
                }
            })

            // Append a new turn id once when the handled rowId is currently last in chatTurnIdsAtom
            const ids = (get(chatTurnIdsAtom) || []) as string[]
            const idx = ids.indexOf(String(rowId))
            const isLast = idx >= 0 && idx === ids.length - 1
            if (isLast && !hasToolCalls) {
                set(chatTurnIdsAtom, (prev) => [...(prev || []), `lt-${generateId()}`])
            }

            return
        }

        const responseHash = buildCompletionResponseText(testResult)
        set(inputRowsByIdAtom, (prev) =>
            produce(prev, (draft: any) => {
                const row = draft?.[rowId]
                if (!row) return
                if (!row.responsesByRevision) row.responsesByRevision = {}
                const arr: any[] = Array.isArray(row.responsesByRevision[variantId])
                    ? row.responsesByRevision[variantId]
                    : []
                const exists = arr.some((m: any) => m?.content?.value === responseHash)
                if (!exists)
                    arr.push({
                        __id: generateId(),
                        role: "assistant",
                        content: {value: responseHash},
                    })
                row.responsesByRevision[variantId] = arr
            }),
        )
        updateStatus(responseHash)
        set(loadingByRowRevisionAtomFamily({rowId, revisionId: variantId}), false)
        console.debug("[WW] completion result", {rowId, variantId, responseHash})
        set(responseByRowRevisionAtomFamily({rowId, revisionId: variantId}), testResult as any)
        const queryClient = get(queryClientAtom)
        queryClient.invalidateQueries({queryKey: ["traces"]})
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
