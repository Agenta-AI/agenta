// Copied verbatim from web/oss/src/components/AgentChatSlice/state/sessionEphemera.ts
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
// Adaptations:
//  (a) `attachmentsBySession` is typed `Map<string, PendingAttachment[]>` (../model/attachments)
//      instead of the desktop's upload-widget file type — the package must not depend on that
//      desktop UI toolkit.
//  (b) the desktop's per-session virtualized-list scroll/row-height snapshot map and its cleanup
//      in `clearSessionEphemera` are OMITTED entirely — that state is desktop-only, and the
//      package must not depend on the desktop's list-virtualization library either.
import type {PendingAttachment} from "../model/attachments"

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
export const attachmentsBySession = new Map<string, PendingAttachment[]>()

/**
 * Sessions created brand-new in this browser and not yet run. A never-run local session has no
 * backend records, so its open-with-empty-cache hydration would be a guaranteed-empty server query.
 * Marked on create, cleared on the first send. In-memory only: after a reload the marker is gone, so
 * a never-run session opened post-reload legitimately falls back to hydrating (we can no longer tell
 * "never ran" from "ran, cache cleared" without asking the server — which is the point of hydration).
 */
export const freshSessionIds = new Set<string>()
export const markSessionFresh = (sessionId: string) => freshSessionIds.add(sessionId)
export const isSessionFresh = (sessionId: string) => freshSessionIds.has(sessionId)
export const clearSessionFresh = (sessionId: string) => freshSessionIds.delete(sessionId)

/** Drop every ephemeral trace of a permanently deleted session. */
export const clearSessionEphemera = (sessionId: string) => {
    composerDraftBySession.delete(sessionId)
    attachmentsBySession.delete(sessionId)
    freshSessionIds.delete(sessionId)
}
