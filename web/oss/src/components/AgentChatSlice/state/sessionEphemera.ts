import type {SessionAttachmentResponse} from "@agenta/chat/assets"
import type {StagedUpload} from "@agenta/chat/model"
import {clearSessionEphemera as clearSharedSessionEphemera} from "@agenta/chat/state"
import type {StateSnapshot} from "react-virtuoso"

/**
 * DESKTOP-ONLY per-session in-memory ephemera. The shared pieces (composer drafts, fresh-session
 * markers, the neutral staged-attachment map) live in @agenta/chat/state — this module holds only
 * what depends on desktop libraries, plus the combined cleanup.
 */

/** Virtuoso state (measured row heights + scrollTop) per session, captured before a route
 * change unmounts the transcript. A fresh Virtuoso mount otherwise renders with height
 * ESTIMATES, measures the real rows async, then corrects — a visible reshuffle on every
 * re-entry (rows span 85–1022px, so the correction is large). Restoring the snapshot
 * paints the transcript at its true geometry and scroll position in the first frame. */
export const virtStateBySession = new Map<string, StateSnapshot>()

/** Pending (not yet sent) upload-tray entries per session — same lifetime as the drafts.
 * `originFileObj` holds live File blobs; typed by the upload response the tray stores. */
export const attachmentsBySession = new Map<string, StagedUpload<SessionAttachmentResponse>[]>()

/** Drop every ephemeral trace of a permanently deleted session, shared AND desktop-only. */
export const clearSessionEphemera = (sessionId: string) => {
    clearSharedSessionEphemera(sessionId)
    virtStateBySession.delete(sessionId)
    attachmentsBySession.delete(sessionId)
}
