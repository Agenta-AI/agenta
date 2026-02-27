// Normalized generation state entities
// Core types and top-level entity maps

import {generateId} from "@agenta/shared/utils"
import {produce} from "immer"
import {atom, getDefaultStore, Getter} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {appChatModeAtom} from "@/oss/components/Playground/state/atoms"
import {generationRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {
    displayedVariantsAtom,
    displayedVariantsVariablesAtom,
    isComparisonViewAtom,
} from "@/oss/components/Playground/state/atoms/variants"
import {mergedMetadataAtom} from "@/oss/lib/hooks/useStatelessVariants/state"
import {buildUserMessage} from "@/oss/state/newPlayground/helpers/messageFactory"

import {selectedAppIdAtom} from "../app"

import {mergeRowVariables, PropertyNode} from "./utils"

export interface InputRow {
    id: string
    // Variables and responses are revision-scoped to unify single/compare
    // Variables are represented as a PropertyNode tree/array to align with UI helpers
    variables: PropertyNode[]
    // Completion responses are an array/tree of PropertyNodes (LLM messages)
    responsesByRevision: Record<string, PropertyNode[]>
    meta?: Record<string, any>
}

export interface ChatSession {
    id: string
    // Session-level variables (e.g., system variables) also revision-scoped
    variables: PropertyNode[]
    turnIds: string[]
    meta?: Record<string, any>
}

export interface ChatTurn {
    id: string
    sessionId: string
    // User message follows PropertyNode structure
    userMessage: PropertyNode
    // Assistant message is revision-scoped and uses PropertyNode
    assistantMessageByRevision: Record<string, PropertyNode | null>
    toolResponsesByRevision?: Record<string, any[] | null>
    meta?: Record<string, any>
}

// Entity maps + id lists
export const inputRowIdsAtom = atom<string[]>([])
export const inputRowsByIdCacheAtom = atom<Record<string, InputRow>>({})
export const inputRowsByIdAtom = inputRowsByIdCacheAtom

export const chatSessionsByIdAtom = atom<Record<string, ChatSession>>({})
export const chatSessionIdsAtom = atom<string[]>([])
// Backing storage for chat turns; do not export directly
export const chatTurnsByIdStorageAtom = atom<Record<string, ChatTurn>>({})

// Cache for per-row overrides (e.g., fast reads or provisional states)
export const chatTurnsByIdCacheAtom = atom<Record<string, ChatTurn>>({})

// Cache variable values by row and variable name to preserve context across revisions
export const inputRowVariableValueCacheAtom = atom<Record<string, Record<string, string>>>({})

export const allChatTurnIdsMapAtom = atom<Record<string, string[]>>({})
// Master list of logical chat turn ids, independent of displayed revisions set
// Global canonical list scoped by baseline revision (first displayed id)
export const chatTurnIdsByBaselineAtom = atom<Record<string, string[]>>({})
// Flat list of chat turn ids (session turn ids like `turn-<rev>-<logical>`)
// Mutating this list will cause derived selectors to expose new chat rows.
export const chatTurnIdsAtom = atom(
    (get) => {
        const displayed = (get(displayedVariantsAtom) || []) as string[]
        // Stable key independent of displayed order
        const key = `set:${[...displayed].sort().join("|")}`
        const map = get(allChatTurnIdsMapAtom)
        const baseline = (displayed[0] || "") as string
        const byBaseline = get(chatTurnIdsByBaselineAtom) || {}
        const existing = map[key]
        if (Array.isArray(existing) && existing.length > 0) {
            return existing
        }

        // Fallback to baseline-scoped list when switching displayed sets (e.g., unloading/replacing revisions)
        const baselineList = (baseline && byBaseline[baseline]) || []
        if (Array.isArray(baselineList) && baselineList.length > 0) {
            // Seed per-set entry from baseline-scoped history
            queueMicrotask(() => {
                getDefaultStore().set(allChatTurnIdsMapAtom, (prev) => {
                    const current = prev[key]
                    if (current) return prev // Already updated
                    return {...prev, [key]: baselineList}
                })
            })
            return baselineList
        }

        // Nothing yet: initialize a first logical id and seed both map and master
        const generated = `lt-${generateId()}`
        const nextList = [generated]
        queueMicrotask(() => {
            const store = getDefaultStore()
            if (baseline) {
                store.set(chatTurnIdsByBaselineAtom, (prev) => ({
                    ...prev,
                    [baseline]: nextList,
                }))
            }
            store.set(allChatTurnIdsMapAtom, (prev) => {
                const current = prev[key]
                if (current) return prev
                return {...prev, [key]: nextList}
            })
        })
        return [generated]
    },
    (get, set, update: string[] | ((prev: string[]) => string[] | void)) => {
        const displayed = (get(displayedVariantsAtom) || []) as string[]
        const key = `set:${[...displayed].sort().join("|")}`

        const prevMap = get(allChatTurnIdsMapAtom)
        const baseline = (displayed[0] || "") as string
        const byBaseline = get(chatTurnIdsByBaselineAtom) || {}
        const prevList = prevMap[key] || (baseline ? byBaseline[baseline] || [] : [])
        const next = update instanceof Function ? update(prevList) : update
        // Persist to both the per-set map and the baseline-scoped history
        if (baseline) set(chatTurnIdsByBaselineAtom, {...byBaseline, [baseline]: next as string[]})
        set(allChatTurnIdsMapAtom, {...prevMap, [key]: next as string[]})
    },
)

export const messageSchemaMetadataAtom = selectAtom(
    mergedMetadataAtom,
    (all) => {
        const entries = Object.entries((all || {}) as Record<string, any>)
        const entry = entries.find(([, v]) => v && v.title === "Message" && v.type === "object")
        return (entry?.[1] as any) || null
    },
    Object.is,
)

// Helper: synthesize a ChatTurn for a given rowId using prompts metadata when possible
function synthesizeTurn(
    rowId: string,
    metadata: any,
    get: <T>(anAtom: {read: (get: any) => T}) => T,
): ChatTurn {
    const match = /^turn-(.+)-(lt-.+)$/.exec(String(rowId))
    const revisionId = match?.[1] || ""
    const sessionId = revisionId ? `session-${revisionId}` : "session-"

    // buildUserMessage handles null metadata via getAllMetadata() fallback
    const userMsg = buildUserMessage(metadata)

    return {
        id: rowId,
        sessionId,
        userMessage: userMsg || null,
        assistantMessageByRevision: revisionId ? {[revisionId]: null} : {},
        toolResponsesByRevision: {},
        meta: {},
    }
}

function messageHasContent(node: any): boolean {
    if (!node) return false

    const rawContent = node?.content?.value ?? node?.content

    if (typeof rawContent === "string") {
        return rawContent.trim().length > 0
    }

    if (Array.isArray(rawContent)) {
        return rawContent.some((part: any) => {
            if (!part) return false
            if (typeof part === "string") return part.trim().length > 0
            const text = part?.text?.value ?? part?.text
            if (typeof text === "string" && text.trim().length > 0) return true
            const url =
                part?.image_url?.url?.value ??
                part?.image_url?.url ??
                part?.imageUrl?.url?.value ??
                part?.imageUrl?.url
            if (typeof url === "string" && url.trim().length > 0) return true
            const fileId =
                part?.file?.file_id?.value ??
                part?.file?.file_id ??
                part?.file_id?.value ??
                part?.file_id
            if (typeof fileId === "string" && fileId.trim().length > 0) return true
            return false
        })
    }

    if (rawContent && typeof rawContent === "object") {
        const nested = (rawContent as any).value ?? rawContent
        if (typeof nested === "string") return nested.trim().length > 0
        if (Array.isArray(nested)) return nested.length > 0
    }

    const fallback = node?.value ?? node?.text?.value ?? node?.text
    if (typeof fallback === "string") return fallback.trim().length > 0

    return false
}

function messageHasToolCalls(node: any): boolean {
    if (!node) return false
    const direct = node?.toolCalls?.value ?? node?.toolCalls
    if (Array.isArray(direct) && direct.length > 0) return true
    const snake = node?.tool_calls?.value ?? node?.tool_calls
    if (Array.isArray(snake) && snake.length > 0) return true
    const fnCall = node?.function_call?.value ?? node?.function_call
    if (fnCall && typeof fnCall === "object") return true
    return false
}

// Family reader/writer for cache entries by rowId
export const chatTurnsByIdFamilyAtom = atomFamily((rowId: string) =>
    atom(
        (get) => {
            // React to visible row structure
            const meta = get(messageSchemaMetadataAtom) as any
            const cache = get(chatTurnsByIdCacheAtom) || {}
            if (rowId in cache) {
                return cache[rowId]
            }
            const base = get(chatTurnsByIdStorageAtom) || {}
            const existing = base[rowId]
            if (existing) {
                return existing
            }
            // Synthesize turn — buildUserMessage handles missing metadata via fallback
            const newTurn = synthesizeTurn(rowId, meta, get)

            if (newTurn) {
                getDefaultStore().set(chatTurnsByIdCacheAtom, {...cache, [rowId]: newTurn})
                return newTurn
            }

            return null
        },
        (
            get,
            set,
            update: ChatTurn | null | ((prev: ChatTurn | null) => ChatTurn | null | void),
        ) => {
            const currentCache = get(chatTurnsByIdCacheAtom) || {}
            const currentBase = get(chatTurnsByIdStorageAtom) || {}
            // Seed a synthesized turn when missing so Immer draft is never undefined
            const prevExisting = (
                rowId in currentCache ? currentCache[rowId] : currentBase[rowId]
            ) as ChatTurn | null

            const meta = get(messageSchemaMetadataAtom) as any
            // Try existing or synthesized; buildUserMessage handles missing metadata via fallback
            let prevVal = prevExisting ?? synthesizeTurn(rowId, meta, get)
            if (!prevVal) {
                return
            }

            let nextVal: ChatTurn | null
            if (typeof update === "function") {
                // Support both Immer-style mutating updater and pure function returning next
                const maybe = produce(prevVal as any, (draft: any) => {
                    const ret = (update as any)(draft)
                    if (ret !== undefined) return ret
                }) as unknown as ChatTurn | null
                nextVal = maybe
            } else {
                nextVal = update
            }

            set(chatTurnsByIdCacheAtom, (prev) => {
                const next = {...(prev || {})}
                if (nextVal) next[rowId] = nextVal
                else if (rowId in next) delete next[rowId]
                return next
            })

            // Derived removal: if user message content is effectively empty, drop this id from chatTurnIdsAtom
            const assistantEntries = Object.keys(nextVal?.assistantMessageByRevision || {})
            const toolEntries = Object.keys(nextVal?.toolResponsesByRevision || {})
            const isEmpty =
                !nextVal?.userMessage && assistantEntries.length === 0 && toolEntries.length === 0
            if (isEmpty) {
                set(chatTurnIdsAtom, (prev) => {
                    const turnIndex = (prev || []).indexOf(rowId)
                    if (turnIndex === -1) return prev
                    return [...prev.slice(0, turnIndex)]
                })
            } else {
                const match = /^turn-(.+)-(lt-.+)$/.exec(String(rowId))
                const revisionId = match?.[1]
                const logicalId = match?.[2] || rowId

                const userHasContent = messageHasContent(nextVal?.userMessage)
                if (!userHasContent || !logicalId) return

                const assistantMapKeys = Object.keys(nextVal?.assistantMessageByRevision || {})
                const activeRevisionId = revisionId || assistantMapKeys[0]

                const assistantNode = activeRevisionId
                    ? nextVal?.assistantMessageByRevision?.[activeRevisionId]
                    : null
                const toolResponsesByRevision = (nextVal as any)?.toolResponsesByRevision || {}
                const revisionToolResponses = activeRevisionId
                    ? toolResponsesByRevision?.[activeRevisionId]
                    : undefined
                const hasToolResponses = Array.isArray(revisionToolResponses)
                    ? revisionToolResponses.length > 0
                    : false
                const hasToolCallsForRevision =
                    hasToolResponses || messageHasToolCalls(assistantNode)

                const assistantHasContent = messageHasContent(assistantNode)

                // When assistant requests tool calls, do not auto-append a pending turn.
                // The next turn should appear only after tool execution or explicit +Message.
                const shouldAppendBlankTurn = !hasToolCallsForRevision && assistantHasContent

                if (!shouldAppendBlankTurn) return

                const ids = (get(chatTurnIdsAtom) || []) as string[]
                const idx = ids.indexOf(String(logicalId))
                const isLast = idx >= 0 && idx === ids.length - 1
                if (!isLast) return

                set(chatTurnIdsAtom, (prev) => {
                    const prevIds = prev || []
                    if (prevIds[prevIds.length - 1] !== logicalId) return prev
                    return [...prevIds, `lt-${generateId()}`]
                })
            }
        },
    ),
)

// Helper: synthesize an InputRow with variables seeded from prompt variables
function synthesizeInputRow(rowId: string, get: Getter): InputRow {
    // Determine target revision ids to seed
    // const idx = get(rowIdIndexAtom)
    // const latest = idx?.[rowId]?.latestRevisionId as string | undefined
    // const displayed = (get(displayedVariantsAtom) || []) as string[]
    // const revisionIds = Array.from(new Set([latest, ...displayed].filter(Boolean))) as string[]

    let variables: PropertyNode[] = []
    const allNames = get(displayedVariantsVariablesAtom)
    //  revisionIds.map((revId) => get(promptVariablesAtomFamily(revId)) || [])
    // const test = get(displayedVariantsVariablesAtom)

    variables = allNames.map((name) => ({
        __id: generateId(),
        key: name,
        __metadata: {
            type: "string",
            title: name,
            description: `Template variable: {{${name}}}`,
        },
        value: "",
        content: {value: ""},
    }))

    return {
        id: rowId,
        variables,
        responsesByRevision: {},
        meta: {},
    }
}

// Family reader/writer for input rows by id, with synthesis fallback
export const inputRowsByIdFamilyAtom = atomFamily((rowId: string) =>
    atom(
        (get) => {
            const cache = get(inputRowsByIdCacheAtom) || {}
            const base = get(inputRowsByIdAtom) || {}
            const existing = (rowId in cache ? cache[rowId] : base[rowId]) as InputRow | undefined
            if (existing) {
                // Complete variables for displayed/active revisions using prompt-derived names
                const idx = get(rowIdIndexAtom)
                const latest = idx?.[rowId]?.latestRevisionId as string | undefined
                const displayed = (get(displayedVariantsAtom) || []) as string[]
                const isChat = get(appChatModeAtom)
                const isComparison = get(isComparisonViewAtom)
                const revisionIds = (
                    !isChat && !isComparison
                        ? displayed
                        : Array.from(new Set([latest, ...displayed].filter(Boolean)))
                ) as string[]

                const valueCache = (get(inputRowVariableValueCacheAtom) || {})[rowId] || {}
                const merged = mergeRowVariables(
                    get as any,
                    existing.variables as any[],
                    revisionIds,
                    valueCache,
                ) as PropertyNode[]
                // If variables changed (added/removed/reordered), sync to cache for consistency
                try {
                    const prevVars = Array.isArray(existing.variables)
                        ? (existing.variables as any[])
                        : []
                    const hasDiff =
                        prevVars.length !== merged.length ||
                        (() => {
                            const a = prevVars.map((n: any) => n?.key ?? n?.__id)
                            const b = merged.map((n: any) => n?.key ?? n?.__id)
                            if (a.length !== b.length) return true
                            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true
                            return false
                        })()
                    if (hasDiff) {
                        const updated = {...existing, variables: merged}
                        getDefaultStore().set(inputRowsByIdCacheAtom, {...cache, [rowId]: updated})
                        return updated
                    }
                } catch {}
                return {...existing, variables: merged}
            } else {
                const newTurn = synthesizeInputRow(rowId, get)
                getDefaultStore().set(inputRowsByIdCacheAtom, {...cache, [rowId]: newTurn})
                return newTurn
            }
        },
        (
            get,
            set,
            update: InputRow | null | ((prev: InputRow | null) => InputRow | null | void),
        ) => {
            const currentCache = get(inputRowsByIdCacheAtom) || {}
            const currentBase = get(inputRowsByIdAtom) || {}

            const prevExisting = (
                rowId in currentCache ? currentCache[rowId] : currentBase[rowId]
            ) as InputRow | null
            // Start from existing or synthesized base
            const baseVal = prevExisting
            // synthesizeInputRow(rowId, get)
            // Re-sync variables against current prompt variables for active revisions
            const idx = get(rowIdIndexAtom)
            const latest = idx?.[rowId]?.latestRevisionId as string | undefined
            const displayed = (get(displayedVariantsAtom) || []) as string[]
            const isChat = get(appChatModeAtom)
            const isComparison = get(isComparisonViewAtom)
            const revisionIds = (
                !isChat && !isComparison
                    ? displayed
                    : Array.from(new Set([latest, ...displayed].filter(Boolean)))
            ) as string[]
            const valueCache = (get(inputRowVariableValueCacheAtom) || {})[rowId] || {}
            const merged = mergeRowVariables(
                get as any,
                baseVal?.variables as any[],
                revisionIds,
                valueCache,
            ) as PropertyNode[]

            const prevVal: InputRow = {...(baseVal as any), variables: merged}

            let nextVal: InputRow | null
            if (typeof update === "function") {
                const maybe = produce(prevVal as any, (draft: any) => {
                    const ret = (update as any)(draft)
                    if (ret !== undefined) return ret
                }) as unknown as InputRow | null
                nextVal = maybe
            } else {
                nextVal = update
            }

            // Update variable value cache first (ensures merges use latest values)
            try {
                if (nextVal && Array.isArray((nextVal as any).variables)) {
                    const latestVars = ((nextVal as any).variables || []) as any[]
                    const map: Record<string, string> = {}
                    for (const n of latestVars) {
                        const k = (n as any)?.key ?? (n as any)?.__id
                        if (!k) continue
                        const v = (n as any)?.content?.value ?? (n as any)?.value
                        const s = v !== undefined && v !== null ? String(v) : ""
                        if (s.length > 0) map[String(k)] = s
                    }
                    if (Object.keys(map).length > 0) {
                        set(inputRowVariableValueCacheAtom, (prev) => ({
                            ...(prev || {}),
                            [rowId]: {...((prev || {})[rowId] || {}), ...map},
                        }))
                    }
                }
            } catch {}

            // Persist synthesized/edited row into cache for visibility via computed map
            set(inputRowsByIdCacheAtom, (prev) => {
                const next = {...(prev || {})}
                if (nextVal) next[rowId] = nextVal
                else if (rowId in next) delete next[rowId]
                return next
            })
        },
    ),
)

// Computed map merging base rows and synthesized cache for visible ids
export const inputRowsByIdComputedAtom = atom((get) => {
    const logicalIds = (get(generationRowIdsAtom) as string[]) || []
    const base = get(inputRowsByIdAtom) || {}
    const cache = get(inputRowsByIdCacheAtom) || {}
    const merged: Record<string, InputRow> = {...base, ...cache}
    for (const id of logicalIds) {
        try {
            const val = get(inputRowsByIdFamilyAtom(id)) as any
            if (val) merged[id] = val as InputRow
        } catch {}
    }
    return merged
})

export const chatTurnsByIdAtom = atom(
    (get) => {
        // React to visible row structure
        const logicalIds = (get(generationRowIdsAtom) as string[]) || []
        const base = get(chatTurnsByIdStorageAtom) || {}
        const cache = get(chatTurnsByIdCacheAtom) || {}
        const merged: Record<string, ChatTurn> = {...base, ...cache}

        // Pull any family-cached entries for the visible ids
        for (const id of logicalIds) {
            try {
                const val = get(chatTurnsByIdFamilyAtom(id)) as any
                if (val) merged[id] = val as ChatTurn
            } catch {}
        }
        return merged
    },
    (get, set, update: Record<string, ChatTurn> | ((prev: Record<string, ChatTurn>) => any)) => {
        // Forward writes to backing storage to preserve existing mutation behavior
        if (typeof update === "function") {
            set(chatTurnsByIdStorageAtom, update as any)
        } else {
            set(chatTurnsByIdStorageAtom, update)
        }
    },
)

// Indexes for bridging legacy rowIds to normalized context during migration
export interface RowIdIndexEntry {
    latestRevisionId?: string
    chatTurnIds?: string[]
}

export const rowIdIndexAtom = atom<Record<string, RowIdIndexEntry>>({})
// Mapping of logical (shared) turn ids to per-revision session turn ids
// logicalTurnId -> { [revisionId]: sessionTurnId }
const logicalTurnIndexByAppAtom = atom<Record<string, Record<string, Record<string, string>>>>({})

export const logicalTurnIndexAtom = atom(
    (get) => {
        const appId = get(selectedAppIdAtom)
        const all = get(logicalTurnIndexByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, Record<string, string>>
            | ((
                  prev: Record<string, Record<string, string>>,
              ) => Record<string, Record<string, string>>),
    ) => {
        const appId = get(selectedAppIdAtom)
        const all = get(logicalTurnIndexByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(logicalTurnIndexByAppAtom, {...all, [appId]: value})
    },
)

// Normalized run status per row + revision
// Keyed by `${rowId}:${revisionId}` to avoid nested structures churn
const runStatusByAppAtom = atom<
    Record<string, Record<string, {isRunning?: string | false; resultHash?: string | null}>>
>({})

export const runStatusByRowRevisionAtom = atom(
    (get) => {
        const appId = get(selectedAppIdAtom)
        const all = get(runStatusByAppAtom)
        return all[appId] ?? {}
    },
    (
        get,
        set,
        next:
            | Record<string, {isRunning?: string | false; resultHash?: string | null}>
            | ((
                  prev: Record<string, {isRunning?: string | false; resultHash?: string | null}>,
              ) => Record<string, {isRunning?: string | false; resultHash?: string | null}>),
    ) => {
        const appId = get(selectedAppIdAtom)
        const all = get(runStatusByAppAtom)
        const prev = all[appId] ?? {}
        const value = typeof next === "function" ? (next as any)(prev) : next
        set(runStatusByAppAtom, {...all, [appId]: value})
    },
)
