// Assembled from the attachment-state block of
// web/oss/src/components/AgentChatSlice/AgentConversation.tsx (2026-07-25): the per-session
// restore/mirror effect, `addFiles` (validateIncoming), `removeFile`, and the submit-time
// clear + `filesToParts` conversion. The desktop host keeps its own upload-item file type;
// this hook mirrors the same LOGIC over the package's neutral `PendingAttachment`.
// Deliberately omitted (desktop-only): the drag/drop DOM handlers and the tray open/close
// flag — the skin calls `add()` from its own drop/paste surfaces and derives visibility.
import {useCallback, useEffect, useRef, useState} from "react"

import type {FileUIPart} from "ai"

import {
    type AttachmentLimits,
    type AttachmentRejection,
    DEFAULT_ATTACHMENT_LIMITS,
    validateIncoming,
} from "../assets/attachmentRules"
import {filesToParts} from "../assets/files"
import {type PendingAttachment, toPendingAttachment} from "../model/attachments"
import {attachmentsBySession} from "../state/sessionEphemera"

export interface UseComposerAttachmentsArgs {
    /** Persist pending files under this session across pane remounts (route re-entry). */
    sessionId?: string
    /** Guardrails; defaults to the shared limits (count / size / accepted types). */
    limits?: AttachmentLimits
}

export interface ComposerAttachments {
    /** Files staged for the next send, in add order. */
    files: PendingAttachment[]
    /** Files turned away by the guardrails on the LAST add (too big, wrong type, over the count). */
    rejections: AttachmentRejection[]
    /** The active guardrails, for tray copy ("up to N files, X MB each"). */
    limits: AttachmentLimits
    /** The staged set is at the count cap — pickers should disable. */
    atMax: boolean
    /** Run incoming files (picker / paste / drop) through the guardrails and stage the accepted. */
    add: (incoming: File[]) => void
    /** Unstage one file by its dedup uid. */
    remove: (uid: string) => void
    /** Drop everything staged (send consumed them, or the user reset the composer). */
    clear: () => void
    /** Dismiss the inline rejection notices without touching the staged files. */
    dismissRejections: () => void
    /** Encode the staged files as inline `file` parts for `sendMessage({text, files})`. */
    toParts: () => Promise<FileUIPart[]>
}

/**
 * Headless composer-attachment state for one session: staging, validation, per-session
 * persistence, and the send-time encoding. The skin owns every surface (tray, drop overlay,
 * paste) and calls `add`/`remove`/`clear`; on submit it awaits `toParts()` then `clear()`s.
 */
export const useComposerAttachments = ({
    sessionId,
    limits = DEFAULT_ATTACHMENT_LIMITS,
}: UseComposerAttachmentsArgs = {}): ComposerAttachments => {
    // Restored from the per-session store on remount (route re-entry, tab close/reopen) —
    // pending attachments survive alongside the composer draft. Rejections stay transient.
    const [files, setFiles] = useState<PendingAttachment[]>(() =>
        sessionId ? (attachmentsBySession.get(sessionId) ?? []) : [],
    )
    // `sessionId` is a prop. Today's only caller mounts one instance per session, but a caller
    // that swapped it in place would carry the old session's staged files into the new one, and
    // the mirror effect below would then write them under the new key. Re-seed during render so
    // that effect never sees a mismatched pair.
    const [seededFor, setSeededFor] = useState(sessionId)
    if (sessionId !== seededFor) {
        setSeededFor(sessionId)
        setFiles(sessionId ? (attachmentsBySession.get(sessionId) ?? []) : [])
    }
    useEffect(() => {
        if (!sessionId) return
        if (files.length > 0) attachmentsBySession.set(sessionId, files)
        else attachmentsBySession.delete(sessionId)
    }, [files, sessionId])
    // Files turned away by the guardrails (too big, wrong type, over the count), shown inline.
    const [rejections, setRejections] = useState<AttachmentRejection[]>([])

    const atMax = files.length >= limits.maxCount

    // The staged count as of the last accepted batch, not the render closure. Two `add` calls
    // in one tick (a paste and a drop, or a duplicated drop handler) both read the same
    // `files.length`, so both compute the same remaining capacity and the staged set can pass
    // `limits.maxCount`. Re-synced on every render so state remains the source of truth.
    const countRef = useRef(files.length)
    countRef.current = files.length

    /** Add files from picker / paste / programmatic sources through the guardrails. */
    const add = useCallback(
        (incoming: File[]) => {
            const {accepted, rejections: rej} = validateIncoming(incoming, countRef.current, limits)
            if (accepted.length) {
                countRef.current += accepted.length
                setFiles((prev) => [...prev, ...accepted.map(toPendingAttachment)])
            }
            setRejections(rej)
        },
        [limits],
    )

    const remove = useCallback((uid: string) => {
        setFiles((prev) => prev.filter((f) => f.uid !== uid))
    }, [])

    const clear = useCallback(() => {
        setFiles([])
        setRejections([])
    }, [])

    const dismissRejections = useCallback(() => setRejections([]), [])

    const toParts = useCallback(
        () => (files.length ? filesToParts(files.map((f) => f.file)) : Promise.resolve([])),
        [files],
    )

    return {files, rejections, limits, atMax, add, remove, clear, dismissRejections, toParts}
}
