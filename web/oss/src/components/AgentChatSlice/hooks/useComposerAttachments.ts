import {useEffect, useRef, useState} from "react"

import {generateId} from "@agenta/shared/utils"
import type {UploadFile} from "antd"

import {
    type AttachmentRejection,
    DEFAULT_ATTACHMENT_LIMITS,
    validateIncoming,
} from "../assets/attachments"
import {isAgentFileUploadsEnabled} from "../assets/constants"
import {attachmentsBySession} from "../state/sessionEphemera"

import {useAttachmentUploads} from "./useAttachmentUploads"

// `uid` is the tray's React key, its preview-URL key, and the remove / view / retry handle, so it
// has to be unique per TRAY ROW. Deriving it from name+mtime+size collided whenever the same file
// was attached twice (paste then drop) — one remove then wiped both rows and their previews.
const toUploadFile = (file: File): UploadFile => ({
    uid: `att-${generateId()}`,
    name: file.name,
    status: "done",
    originFileObj: file as UploadFile["originFileObj"],
})

/**
 * Pending composer attachments for one session — the tray, its guardrails, the upload lifecycle,
 * the preview target, and the whole-panel drag-and-drop that feeds them. Files survive a remount
 * (route re-entry, tab close/reopen) alongside the composer draft; rejections stay transient.
 */
export const useComposerAttachments = ({sessionId}: {sessionId: string}) => {
    // Attach button + attachment preview + drive uploads (`NEXT_PUBLIC_AGENT_FILE_UPLOADS`). Paste
    // and drag-to-attach predate the flag and stay on.
    const uploadsEnabled = isAgentFileUploadsEnabled()
    // Restored from the per-session store on remount (route re-entry, tab close/reopen) —
    // pending attachments survive alongside the composer draft. Rejections stay transient.
    const [files, setFiles] = useState<UploadFile[]>(
        () => attachmentsBySession.get(sessionId) ?? [],
    )
    useEffect(() => {
        if (files.length > 0) attachmentsBySession.set(sessionId, files)
        else attachmentsBySession.delete(sessionId)
    }, [files, sessionId])
    // Files turned away by the guardrails (too big, wrong type, over the count), shown inline.
    const [rejections, setRejections] = useState<AttachmentRejection[]>([])
    // The attachment currently open in the Files-drawer preview (its uid), or null when closed.
    const [viewingUid, setViewingUid] = useState<string | null>(null)
    const [attachmentsOpen, setAttachmentsOpen] = useState(false)
    // Single limits object so it can later be swapped for capability-derived limits.
    const limits = DEFAULT_ATTACHMENT_LIMITS
    const atMax = files.length >= limits.maxCount
    // Drag-over state for the whole-panel drop overlay (depth counter avoids child flicker).
    const dragDepthRef = useRef(0)
    const [isDragging, setIsDragging] = useState(false)

    // Upload lifecycle for the tray (progress / error / retry). The transport is not wired yet, so
    // no uploader is passed — files stay "done" and enqueue is a no-op. When upload lands, provide
    // an uploader here and the whole flow runs; the tray already renders every state.
    const uploads = useAttachmentUploads(files, setFiles, undefined)
    // A staged attachment blocks send only once uploads exist: while any is uploading or has failed,
    // the message isn't ready. All-"done" today, so this is inert until the transport is wired.
    const attachmentsSettled = !files.some((f) => f.status === "uploading" || f.status === "error")

    /** Add files from paste / programmatic sources through the guardrails. */
    const addFiles = (incoming: File[], extraRejections: AttachmentRejection[] = []) => {
        const {accepted, rejections} = validateIncoming(incoming, files.length, limits)
        const allRejections = [...extraRejections, ...rejections]
        if (accepted.length) {
            // Stage once and enqueue the MINTED uids — re-deriving them here is what let the tray
            // row and its upload disagree about which entry they addressed.
            const staged = accepted.map(toUploadFile)
            setFiles((prev) => [...prev, ...staged])
            uploads.enqueue(staged.map((f) => f.uid))
        }
        setRejections(allRejections)
        // Open for rejections too. Otherwise dropping something unsupported writes a message into
        // a closed panel and reads as nothing having happened at all.
        if (accepted.length || allRejections.length) setAttachmentsOpen(true)
    }

    const removeFile = (uid: string) => setFiles((prev) => prev.filter((f) => f.uid !== uid))

    // Native drag-and-drop onto the whole panel. A depth counter ignores dragenter/leave from
    // nested children so the overlay doesn't flicker; only file drags (not text) are handled.
    const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

    /**
     * Bind the panel's drop target. `isBlocked` is a predicate, read at EVENT time and never at
     * bind time: whether attachments are refused right now is the conversation's call (a voice take
     * in flight, a disabled composer), so this hook asks rather than tracking it.
     */
    const bindDropTarget = (isBlocked: () => boolean) => {
        // The panel is ALWAYS a drop target for file drags — preventDefault on enter/over/drop even when
        // blocked. Otherwise the browser's default action for a file drop is to navigate to it, which
        // unloads the SPA and discards the whole conversation. Whether we ACCEPT the files is signalled
        // separately (the overlay + the drop cursor), not by declining to be a drop target.
        const onDragEnter = (e: React.DragEvent) => {
            if (!isFileDrag(e)) return
            e.preventDefault()
            if (isBlocked()) return
            dragDepthRef.current += 1
            setIsDragging(true)
        }
        const onDragOver = (e: React.DragEvent) => {
            if (!isFileDrag(e)) return
            e.preventDefault()
            // Honest cursor: "no drop" while blocked — but we stay a target so the drop is still swallowed.
            e.dataTransfer.dropEffect = isBlocked() ? "none" : "copy"
        }
        const onDragLeave = (e: React.DragEvent) => {
            if (!isFileDrag(e)) return
            dragDepthRef.current -= 1
            if (dragDepthRef.current <= 0) {
                dragDepthRef.current = 0
                setIsDragging(false)
            }
        }
        const onDrop = (e: React.DragEvent) => {
            if (!isFileDrag(e)) return
            e.preventDefault()
            dragDepthRef.current = 0
            setIsDragging(false)
            if (isBlocked()) return

            // A dropped folder still arrives in `files` — as a typeless, zero-byte entry that the
            // guardrails would reject as "not a supported file type", which is misleading. Name it.
            // `webkitGetAsEntry` is only valid synchronously, during this event.
            const folderNames = Array.from(e.dataTransfer.items ?? [])
                .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
                .filter((entry): entry is FileSystemEntry => !!entry?.isDirectory)
                .map((entry) => entry.name)

            const dropped = Array.from(e.dataTransfer.files).filter(
                (f) => !folderNames.includes(f.name),
            )
            const folderRejections = folderNames.map((name) => ({
                name,
                reason: "is a folder — drop the files inside it",
            }))

            if (dropped.length || folderRejections.length) addFiles(dropped, folderRejections)
        }
        return {onDragEnter, onDragOver, onDragLeave, onDrop}
    }

    /** Everything the composer just sent has left — drop the pending set and any rejection notice. */
    const clearAttachments = () => {
        setFiles([])
        setRejections([])
        setAttachmentsOpen(false)
    }

    return {
        uploadsEnabled,
        files,
        rejections,
        setRejections,
        attachmentsOpen,
        setAttachmentsOpen,
        viewingUid,
        setViewingUid,
        limits,
        atMax,
        attachmentsSettled,
        isDragging,
        addFiles,
        removeFile,
        uploads,
        clearAttachments,
        bindDropTarget,
    }
}
