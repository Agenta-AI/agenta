import {atom} from "jotai"

/**
 * A session this client created and the server cannot list yet.
 *
 * A session becomes real on the backend only once its first turn is admitted — a slow runner can
 * take seconds — but the client minted its id and knows the agent and the first message from the
 * moment that message left the composer. Session lists read this registry so a brand-new session
 * appears the instant it is sent, not when the next list refetch happens to carry it (#6776).
 *
 * Sibling of `freshSessions`: that one is a synchronous predicate for "no durable records yet",
 * read during render; this one is reactive, so a list can subscribe to it.
 */
export interface LocalSession {
    sessionId: string
    /** The owning agent's workflow id, where the creating surface knows it. */
    agentId: string | null
    /** The first message, until the server names the session itself. */
    name: string | null
    /** ms epoch, so the row can take its place in a date-ordered list. */
    createdAt: number
}

export const localSessionsAtom = atom<Record<string, LocalSession>>({})

/** Longest a first message can reasonably be a title. */
const LOCAL_SESSION_NAME_MAX = 120

export const localSessionNameFromText = (text: string | null | undefined): string | null => {
    const line = (text ?? "").trim().split("\n")[0]?.trim() ?? ""
    if (!line) return null
    return line.length > LOCAL_SESSION_NAME_MAX ? `${line.slice(0, LOCAL_SESSION_NAME_MAX)}…` : line
}

/**
 * Note a session this client just sent a message into. Idempotent: a repeat keeps the first
 * message as the name and only fills in an agent it did not know before.
 */
export const registerLocalSessionAtom = atom(
    null,
    (
        get,
        set,
        input: {sessionId: string; agentId?: string | null; name?: string | null; now?: number},
    ) => {
        const current = get(localSessionsAtom)
        const existing = current[input.sessionId]
        const name = existing?.name ?? localSessionNameFromText(input.name)
        const agentId = existing?.agentId ?? input.agentId ?? null
        if (existing && existing.name === name && existing.agentId === agentId) return
        set(localSessionsAtom, {
            ...current,
            [input.sessionId]: {
                sessionId: input.sessionId,
                agentId,
                name,
                createdAt: existing?.createdAt ?? input.now ?? Date.now(),
            },
        })
    },
)

/** The server lists these now (or they were deleted): the local copies have done their job. */
export const forgetLocalSessionsAtom = atom(null, (get, set, ids: Iterable<string>) => {
    const current = get(localSessionsAtom)
    let next: Record<string, LocalSession> | null = null
    for (const id of ids) {
        if (!(id in current)) continue
        next ??= {...current}
        delete next[id]
    }
    if (next) set(localSessionsAtom, next)
})
