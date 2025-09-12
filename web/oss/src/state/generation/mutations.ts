import {produce} from "immer"
import {atom} from "jotai"

// Legacy playground mutations we will forward to during migration
// Legacy mutations removed; implement normalized writes directly

import {chatTurnsByIdAtom, inputRowsByIdAtom, rowIdIndexAtom} from "./entities"

/**
 * Write-through mutations for normalized generation state.
 *
 * During migration these forward to legacy mutations to keep behavior intact,
 * while also providing a stable surface for future normalized-store updates.
 */

// Add a user/assistant/system message to a chat row
export const addMessageWTMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            rowId: string
            message: {role?: "user" | "assistant" | "system"; content: string; __id?: string}
        },
    ) => {
        // Normalized write-through (completion path)
        const idx = get(rowIdIndexAtom)[params.rowId]
        const revId = idx?.latestRevisionId
        if (!revId) return

        set(inputRowsByIdAtom, (prev) =>
            produce(prev, (draft) => {
                const row = draft[params.rowId]
                if (!row) return
                if (!row.responsesByRevision) row.responsesByRevision = {}
                const bucket = row.responsesByRevision[revId] || []
                // Create a minimal PropertyNode aligned with UI expectations
                const node = {
                    __id: params.message.__id ?? `${Date.now()}-${Math.random()}`,
                    role: params.message.role ?? "user",
                    content: {value: params.message.content},
                } as any
                row.responsesByRevision[revId] = [...bucket, node]
            }),
        )

        // If this is a user message, index as a chat turn and persist userMessage content
        if (params.message.role === "user" && params.message.__id) {
            const turnId = params.message.__id
            // Update rowId index with this turn id (deduped)
            set(rowIdIndexAtom, (prev) => {
                const entry = prev[params.rowId] || {}
                const existing = entry.chatTurnIds || []
                const next = Array.from(new Set([...existing, turnId]))
                return {
                    ...prev,
                    [params.rowId]: {
                        ...entry,
                        chatTurnIds: next,
                    },
                }
            })

            // Create or update ChatTurn with userMessage content
            set(chatTurnsByIdAtom, (prev) =>
                produce(prev, (draft) => {
                    if (!draft[turnId]) {
                        draft[turnId] = {
                            id: turnId,
                            sessionId: params.rowId, // treat row as session during migration
                            userMessage: {
                                __id: turnId,
                                role: "user",
                                content: {value: params.message.content},
                            } as any,
                            assistantMessageByRevision: {},
                        } as any
                        return
                    }
                    const t = draft[turnId]
                    t.userMessage = {
                        ...(t.userMessage || {__id: turnId, role: "user"}),
                        content: {value: params.message.content},
                    } as any
                }),
            )
        }

        // Normalized write-through (chat path - assistant messages only, when mapped)
        if (params.message.role === "assistant" && params.message.__id && idx?.chatTurnIds) {
            const turnId = params.message.__id
            if (idx.chatTurnIds.includes(turnId)) {
                set(chatTurnsByIdAtom, (prev) =>
                    produce(prev, (draft) => {
                        let turn = draft[turnId]
                        if (!turn) {
                            // Create a minimal ChatTurn entity for this row/session
                            draft[turnId] = {
                                id: turnId,
                                sessionId: params.rowId, // treat row as session for migration
                                userMessage: {
                                    __id: `${turnId}-user`,
                                    role: "user",
                                } as any,
                                assistantMessageByRevision: {},
                            } as any
                            turn = draft[turnId]
                        }
                        if (!turn.assistantMessageByRevision) turn.assistantMessageByRevision = {}
                        const node = {
                            __id: params.message.__id,
                            role: "assistant",
                            content: {value: params.message.content},
                        } as any
                        turn.assistantMessageByRevision[revId] = node
                    }),
                )
            }
        }
    },
)

// Delete a message by id; variantId is optional but used by legacy to disambiguate __runs
export const deleteMessageWTMutationAtom = atom(
    null,
    (get, set, params: {rowId: string; messageId: string; variantId?: string}) => {
        // Normalized write-through (completion path only for now)
        const idx = get(rowIdIndexAtom)[params.rowId]
        const revId = idx?.latestRevisionId
        if (!revId) return

        set(inputRowsByIdAtom, (prev) =>
            produce(prev, (draft) => {
                const row = draft[params.rowId]
                if (!row?.responsesByRevision?.[revId]) return
                const arr = row.responsesByRevision[revId]
                const i = arr.findIndex((n: any) => n?.__id === params.messageId)
                if (i >= 0) {
                    arr.splice(i, 1)
                }
            }),
        )
    },
)

// Update variables for a row at a specific revision (placeholder)
export const updateVariablesWTMutationAtom = atom(
    null,
    (_get, _set, _params: {rowId: string; revisionId: string; variables: any}) => {
        // TODO(normalized): implement when normalized variable editing is wired
        // Intentionally a no-op for now to keep API surface stable
        if (process.env.NODE_ENV === "development") {
            console.debug("(noop) updateVariablesWTMutationAtom")
        }
    },
)

// Set assistant response(s) for a chat turn at a revision (placeholder)
export const setAssistantResponseWTMutationAtom = atom(
    null,
    (
        _get,
        _set,
        _params: {
            rowId: string
            historyId: string
            revisionId: string
            variantId: string
            messages: any[] | any
        },
    ) => {
        // TODO(normalized): implement when run pipeline writes normalized responses
        if (process.env.NODE_ENV === "development") {
            console.debug("(noop) setAssistantResponseWTMutationAtom")
        }
    },
)
