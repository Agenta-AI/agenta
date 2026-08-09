import type {UIMessage} from "ai"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {composerDraftBySession, markUnloggedHistory} from "./sessionEphemera"
import {addSessionAtomFamily, closeSessionAtomFamily, persistSessionMessagesAtom} from "./sessions"

/**
 * Rewind = FORK, because neither the backend nor the runner can represent a truncation.
 *
 * The durable record log is append-only (`POST /sessions/records` ingests, nothing prunes or
 * supersedes) and records carry no branch/parent pointer, so a locally-truncated transcript is
 * resurrected by the next hydration/revalidation of the same session id. The runner is the same
 * story from the model's side: a warm session (or a cold one that reloads its harness session via
 * ACP `session/load`) answers from its OWN native transcript and is sent only the trailing user
 * message, so re-sending into the same session id leaves the agent remembering everything the user
 * just rewound past.
 *
 * A new session id is the one lever both layers honour: no log to resurrect, no continuity record
 * to reload. So a rewind starts a fresh session seeded with the kept prefix, and the original
 * conversation stays whole under its own id (closed as a tab, still in history and on the server).
 */
export interface RewindForkInput {
    /** The conversation being rewound; its tab closes, its history entry and records stay. */
    fromSessionId: string
    /** Kept prefix — everything strictly before the rewind point. Seeds the fork's transcript. */
    messages: UIMessage[]
    /** Pre-fill the fork's composer with the rewound message so the user can edit and re-send. */
    draft?: string
    /** Re-run the prefix's trailing user turn on mount instead (the assistant-side rewind). */
    rerun?: boolean
}

/**
 * The fork the freshly-mounted conversation must auto-re-run (assistant-side rewind: "re-run this
 * turn"). Holds a session id, consumed once by that session's pane. A user-side rewind leaves this
 * null and pre-fills the composer instead — the same "edit and re-run" it has always offered.
 */
export const pendingRewindRerunAtom = atom<string | null>(null)

/**
 * Fork a conversation at the rewind point. Returns the new session id.
 *
 * Composed from the existing session writers on purpose — `addSession` already creates the history
 * entry, opens the tab, marks it fresh (so hydration skips its guaranteed-empty query) and makes it
 * active; the seed and the close are the only additions.
 */
export const rewindForkAtomFamily = atomFamily((key: string) =>
    atom(null, (_get, set, {fromSessionId, messages, draft, rerun}: RewindForkInput): string => {
        const forkId = set(addSessionAtomFamily(key))
        // Seeded with no record watermark: this transcript is not a copy of any server log.
        set(persistSessionMessagesAtom, {id: forkId, messages, recordCount: undefined})
        // The prefix exists only here, so the fork's FIRST request has to carry it.
        if (messages.length > 0) markUnloggedHistory(forkId)
        if (draft?.trim()) composerDraftBySession.set(forkId, draft)
        set(pendingRewindRerunAtom, rerun ? forkId : null)
        // Closing keeps the session in history (it has messages, so it isn't a husk) — the rewound
        // conversation is one click away in the history picker rather than sitting beside the fork.
        set(closeSessionAtomFamily(key), fromSessionId)
        return forkId
    }),
)
