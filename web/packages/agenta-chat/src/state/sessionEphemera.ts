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

/** Per-session memory survives pane remounts but is cleared on permanent deletion. */

/** Unsent composer drafts per session — switching back to a session restores its
 * in-progress message. */
export const composerDraftBySession = new Map<string, string>()

/** Pending (not yet sent) attachments per session — same lifetime as the drafts. */
export const attachmentsBySession = new Map<string, StagedUpload<unknown>[]>()

/** In-memory turn guards are never restored across page loads. */
export const turnIdBySession = new Map<string, string>()
const supersededTurnIdsBySession = new Map<string, Set<string>>()

export const setSessionTurnId = (sessionId: string, turnId: string) => {
    if (supersededTurnIdsBySession.get(sessionId)?.has(turnId)) return
    turnIdBySession.set(sessionId, turnId)
}

export const getSessionTurnId = (sessionId: string): string | undefined =>
    turnIdBySession.get(sessionId)

/** Clear the old guard before starting a replacement turn. */
export const clearSessionTurnId = (sessionId: string) => {
    const current = turnIdBySession.get(sessionId)
    if (current) {
        const superseded = supersededTurnIdsBySession.get(sessionId) ?? new Set<string>()
        superseded.add(current)
        supersededTurnIdsBySession.set(sessionId, superseded)
    }
    turnIdBySession.delete(sessionId)
}

/** Accepted shared-path execution ids that still own their session turn after the invoke stream
 * disconnects. A null id means the acceptance lacked a usable correlation id. */
export const acceptedRunBySession = new Map<string, string | null>()

export type TurnDeliverySource = "legacy" | "shared"

/** One rendering source per local turn, retained across a pane remount. */
export const turnDeliverySourceBySession = new Map<string, TurnDeliverySource>()

// The fresh-session registry moved to @agenta/entities/session — the drive needs the same
// predicate, and this package sits ABOVE entity-ui so it cannot be imported from there.
export {freshSessionIds}
export {clearSessionFresh, isSessionFresh, markSessionFresh} from "@agenta/entities/session"

/** Drop every ephemeral trace of a permanently deleted session. */
export const clearSessionEphemera = (sessionId: string) => {
    composerDraftBySession.delete(sessionId)
    attachmentsBySession.delete(sessionId)
    turnIdBySession.delete(sessionId)
    supersededTurnIdsBySession.delete(sessionId)
    acceptedRunBySession.delete(sessionId)
    turnDeliverySourceBySession.delete(sessionId)
    freshSessionIds.delete(sessionId)
}
