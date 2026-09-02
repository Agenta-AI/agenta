// Copied verbatim from web/oss/src/components/AgentChatSlice/state/sessionEphemera.ts
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
// Adaptations:
//  (a) `attachmentsBySession` holds the staged upload-tray entries (`StagedUpload`)
//      instead of the desktop's upload-widget file type — the package must not depend on that
//      desktop UI toolkit.
//  (b) the desktop's per-session virtualized-list scroll/row-height snapshot map and its cleanup
//      in `clearSessionEphemera` are OMITTED entirely — that state is desktop-only, and the
//      package must not depend on the desktop's list-virtualization library either.
import {freshSessionIds} from "@agenta/entities/session"

import type {StagedUpload} from "../model"

/**
 * Per-session in-memory ephemera that must survive pane remounts (route re-entry, tab
 * close/reopen) but NOT a session's deletion. Lives outside React and outside the
 * persisted session atoms:
 * - composer drafts/attachments hold live `File` blobs that can't be serialized.
 *
 * `deleteSessionAtomFamily` / `resetScopeAtomFamily` call `clearSessionEphemera` alongside
 * their `sessionMessagesAtom` cleanup, so deleted sessions don't retain blobs for the rest
 * of the page lifetime.
 */

/** Unsent composer drafts per session — switching back to a session restores its
 * in-progress message. */
export const composerDraftBySession = new Map<string, string>()

/** Pending (not yet sent) attachments per session — same lifetime as the drafts. */
export const attachmentsBySession = new Map<string, StagedUpload<unknown>[]>()

/**
 * The turn id of the run this browser is watching, per session, read off the streaming message's
 * metadata (see `latestTurnId`). Stop sends it as `expected_execution_id` so the server cancels
 * THAT turn or nothing.
 *
 * In memory on purpose, not persisted with the messages. A reload starts empty, so Stop falls back
 * to sending no guard rather than naming a turn from a past page load — a stale id would refuse a
 * Stop that is correct, which is worse than the bug it guards.
 *
 * Here rather than in an atom because nothing renders it: it is written once per turn and read
 * once, when the user presses Stop. A new turn overwrites it, so the stored id is always the last
 * turn this browser saw begin. Kept past the end of the turn on purpose — a turn parked on an
 * approval has finished streaming and is still the turn a Stop means.
 */
export const turnIdBySession = new Map<string, string>()

export const setSessionTurnId = (sessionId: string, turnId: string) => {
    turnIdBySession.set(sessionId, turnId)
}

export const getSessionTurnId = (sessionId: string): string | undefined =>
    turnIdBySession.get(sessionId)

export const clearSessionTurnId = (sessionId: string) => {
    turnIdBySession.delete(sessionId)
}

// The fresh-session registry moved to @agenta/entities/session — the drive needs the same
// predicate, and this package sits ABOVE entity-ui so it cannot be imported from there.
export {freshSessionIds}
export {clearSessionFresh, isSessionFresh, markSessionFresh} from "@agenta/entities/session"

/** Drop every ephemeral trace of a permanently deleted session. */
export const clearSessionEphemera = (sessionId: string) => {
    composerDraftBySession.delete(sessionId)
    attachmentsBySession.delete(sessionId)
    turnIdBySession.delete(sessionId)
    freshSessionIds.delete(sessionId)
}
