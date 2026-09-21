import {atom} from "jotai"

/**
 * A session this client created and the server cannot list yet.
 *
 * A session becomes real on the backend only once its first turn is admitted — a slow runner can
 * take seconds — but the client minted its id and knows the agent and the first message from the
 * moment that message left the composer. Session lists read this registry so a brand-new session
 * appears the instant it is sent, not when the next list refetch happens to carry it (#6776).
 *
 * Lifecycle: `submitting` from the send until it is admitted, then `accepted` until the server
 * lists the session and `forgetLocalSessionsAtom` retires the copy. A send that fails while still
 * `submitting` takes its row with it — nothing on the server will ever list that session.
 *
 * Sibling of `freshSessions`: that one is a synchronous predicate for "no durable records yet",
 * read during render; this one is reactive, so a list can subscribe to it.
 */
export interface LocalSession {
    sessionId: string
    /** The project it was created in. A list shows only its own project's rows. */
    projectId: string
    /** The owning agent's workflow id, where the creating surface knows it. */
    agentId: string | null
    /** The first message, until the server names the session itself. */
    name: string | null
    /** ms epoch, so the row can take its place in a date-ordered list. */
    createdAt: number
    state: "submitting" | "accepted"
    /** The send that admitted it, so its own later failure is distinguishable from a newer
     * message's. A non-durable send reports admission on reaching the transport, which an error
     * before any turn was named then retracts. */
    admittedBy?: string
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
        input: {
            sessionId: string
            projectId: string
            agentId?: string | null
            name?: string | null
            now?: number
        },
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
                projectId: existing?.projectId ?? input.projectId,
                agentId,
                name,
                createdAt: existing?.createdAt ?? input.now ?? Date.now(),
                state: existing?.state ?? "submitting",
            },
        })
    },
)

/** A send into this session was admitted: the server will list it, so the row stays until then. */
export const markLocalSessionAcceptedAtom = atom(
    null,
    (get, set, input: {sessionId: string; sendId?: string}) => {
        const current = get(localSessionsAtom)
        const existing = current[input.sessionId]
        if (!existing || existing.state === "accepted") return
        set(localSessionsAtom, {
            ...current,
            [input.sessionId]: {...existing, state: "accepted", admittedBy: input.sendId},
        })
    },
)

/**
 * A send into this session failed. If nothing was ever admitted the server will never list the
 * session, so the row goes. An accepted session keeps its row: that failure belongs to a later
 * message, and the server list is what retires the copy — unless the failing send IS the one that
 * admitted it, which is an admission being retracted rather than a later message failing.
 */
export const dropUnacceptedLocalSessionAtom = atom(
    null,
    (get, set, input: {sessionId: string; sendId?: string}) => {
        const current = get(localSessionsAtom)
        const existing = current[input.sessionId]
        if (!existing) return
        const retracting =
            existing.state === "accepted" && !!input.sendId && existing.admittedBy === input.sendId
        if (existing.state === "accepted" && !retracting) return
        const next = {...current}
        delete next[input.sessionId]
        set(localSessionsAtom, next)
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
