import type {UploadFile} from "antd"
import type {StateSnapshot} from "react-virtuoso"

/**
 * Per-session in-memory ephemera that must survive pane remounts (route re-entry, tab
 * close/reopen) but NOT a session's deletion. Lives outside React and outside the
 * persisted session atoms:
 * - virtuoso state carries measured row heights, meaningless once the transcript is gone;
 * - composer drafts/attachments hold live `File` blobs that can't be serialized.
 *
 * `deleteSessionAtomFamily` / `resetScopeAtomFamily` call `clearSessionEphemera` alongside
 * their `sessionMessagesAtom` cleanup, so deleted sessions don't retain blobs for the rest
 * of the page lifetime.
 */

/** Virtuoso state (measured row heights + scrollTop) per session, captured before a route
 * change unmounts the transcript. A fresh Virtuoso mount otherwise renders with height
 * ESTIMATES, measures the real rows async, then corrects — a visible reshuffle on every
 * re-entry (rows span 85–1022px, so the correction is large). Restoring the snapshot
 * paints the transcript at its true geometry and scroll position in the first frame. */
export const virtStateBySession = new Map<string, StateSnapshot>()

/** Unsent composer drafts per session — switching back to a session restores its
 * in-progress message. */
export const composerDraftBySession = new Map<string, string>()

/** Pending (not yet sent) attachments per session — same lifetime as the drafts.
 * `UploadFile.originFileObj` holds live File blobs. */
export const attachmentsBySession = new Map<string, UploadFile[]>()

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
    virtStateBySession.delete(sessionId)
    composerDraftBySession.delete(sessionId)
    attachmentsBySession.delete(sessionId)
    freshSessionIds.delete(sessionId)
}
