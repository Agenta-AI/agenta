import {useCallback, useEffect, useRef, useState} from "react"

import {generateId} from "@agenta/shared/utils"

import {
    type AttachmentRejection,
    DEFAULT_ATTACHMENT_LIMITS,
    attachmentRefsToParts,
    validateIncoming,
} from "../assets"
import {uploadAttachment, type SessionAttachmentResponse} from "../assets/attachmentTransport"
import type {StagedUpload as UploadFile} from "../model"
import {attachmentsBySession} from "../state/sessionEphemera"

import {removeUploadFile, useAttachmentUploads} from "./useAttachmentUploads"

type StagedFile = UploadFile<SessionAttachmentResponse>

/** Convert settled upload-tray entries into reference `file` parts via the neutral builder. */
export const stagedFilesToParts = (files: StagedFile[], sessionId: string) =>
    attachmentRefsToParts(
        files.map((file) => {
            const attachment = file.response?.attachment
            if (!attachment) throw new Error(`Attachment upload is incomplete: ${file.name}`)
            return {
                attachmentId: attachment.attachment_id,
                filename: attachment.filename,
                mediaType: attachment.media_type,
                size: attachment.size,
            }
        }),
        sessionId,
    )

// `uid` is the tray's React key, its preview-URL key, the remove / view / retry handle, and the
// upload's idempotency key, so it has to be unique per TRAY ROW. Deriving it from name+mtime+size
// collided whenever the same file was attached twice (paste then drop) — one remove then wiped
// both rows and their previews.
const toUploadFile = (file: File, uploadsEnabled: boolean): StagedFile => ({
    uid: `att-${generateId()}`,
    name: file.name,
    status: uploadsEnabled ? "uploading" : "done",
    percent: uploadsEnabled ? 0 : 100,
    originFileObj: file as UploadFile["originFileObj"],
})

/**
 * Pending composer attachments for one session — the tray, its guardrails, the upload lifecycle,
 * the preview target, and the whole-panel drag-and-drop that feeds them. Files survive a remount
 * (route re-entry, tab close/reopen) alongside the composer draft; rejections stay transient.
 */
export const useComposerAttachments = ({
    sessionId,
    uploadsEnabled = true,
}: {
    sessionId: string
    /** Hosts gate the whole attachment path on their rollout flag; off = inline-only staging. */
    uploadsEnabled?: boolean
}) => {
    // Restored from the per-session store on remount (route re-entry, tab close/reopen) —
    // pending attachments survive alongside the composer draft. Rejections stay transient.
    const [files, setFiles] = useState<StagedFile[]>(
        () => (attachmentsBySession.get(sessionId) as StagedFile[] | undefined) ?? [],
    )
    // Which session the rows in `files` belong to. The initializer above only runs on MOUNT, and
    // hosts are not required to remount (or key) the composer per session — this repo's chat
    // workspace keeps tab panes mounted across switches. Without this, a `sessionId` change on a
    // mounted hook would write session A's staged rows under session B, orphaning A's entry; and
    // since `attachmentUploader` closes over `sessionId`, a retry would then upload A's file into B.
    const filesOwnerRef = useRef(sessionId)
    // Files turned away by the guardrails (too big, wrong type, over the count), shown inline.
    // Same-tick guard: a paste and a drop can both fire before React re-renders; the render
    // closure's `files.length` would let both batches validate against the pre-add count.
    const stagedCountRef = useRef(files.length)
    useEffect(() => {
        stagedCountRef.current = files.length
    }, [files.length])
    const [rejections, setRejections] = useState<AttachmentRejection[]>([])
    // The attachment currently open in the Files-drawer preview (its uid), or null when closed.
    const [viewingUid, setViewingUid] = useState<string | null>(null)
    const [attachmentsOpen, setAttachmentsOpen] = useState(false)
    useEffect(() => {
        // Park whatever is on screen under the session it actually belongs to…
        const owner = filesOwnerRef.current
        if (files.length > 0) attachmentsBySession.set(owner, files)
        else attachmentsBySession.delete(owner)
        if (owner === sessionId) return
        // …then adopt the incoming session's own staged rows. (This effect re-runs once more with
        // the two ids equal, which writes the adopted rows back under the same key — a no-op.)
        filesOwnerRef.current = sessionId
        setFiles((attachmentsBySession.get(sessionId) as StagedFile[] | undefined) ?? [])
        // The preview target and the inline rejections belong to the session we just left.
        setViewingUid(null)
        setRejections([])
    }, [files, sessionId])
    // Single limits object so it can later be swapped for capability-derived limits.
    const limits = DEFAULT_ATTACHMENT_LIMITS
    const atMax = files.length >= limits.maxCount
    // Drag-over state for the whole-panel drop overlay (depth counter avoids child flicker).
    const dragDepthRef = useRef(0)
    const [isDragging, setIsDragging] = useState(false)

    // One multipart upload per staged file; the tray uid doubles as the idempotency key, so a
    // retry reuses the original identity instead of minting a second attachment.
    const attachmentUploader = useCallback(
        (
            file: File,
            {
                uid,
                onProgress,
                signal,
            }: {uid: string; onProgress: (percent: number) => void; signal: AbortSignal},
        ) => uploadAttachment({file, sessionId, idempotencyKey: uid, onProgress, signal}),
        [sessionId],
    )
    // Upload lifecycle for the tray (progress / error / retry).
    const uploads = useAttachmentUploads(files, setFiles, attachmentUploader)
    // In-flight `uploadExtraFiles` requests — see there. Aborted on unmount, mirroring the tray's
    // own teardown in `useAttachmentUploads`.
    const extraControllers = useRef(new Set<AbortController>())
    useEffect(() => {
        const inFlight = extraControllers.current
        return () => {
            inFlight.forEach((controller) => controller.abort())
            inFlight.clear()
        }
    }, [])
    // A staged attachment blocks send until its reference exists; without uploads the inline path
    // only needs every entry to be settled.
    const attachmentsSettled = uploadsEnabled
        ? files.every((file) => file.status === "done" && Boolean(file.response?.attachment))
        : files.every((file) => file.status === "done")

    /** Why send is held, for the send button's tooltip. */
    const uploadBlockReason = files.some((file) => file.status === "error")
        ? "an upload failed"
        : files.some((file) => file.status === "uploading")
          ? "waiting for uploads"
          : undefined

    /** Add files from paste / programmatic sources through the guardrails. */
    const addFiles = (incoming: File[], extraRejections: AttachmentRejection[] = []) => {
        const {accepted, rejections} = validateIncoming(incoming, stagedCountRef.current, limits)
        const allRejections = [...extraRejections, ...rejections]
        if (accepted.length) {
            // Stage once and enqueue the MINTED uids — re-deriving them here is what let the tray
            // row and its upload disagree about which entry they addressed.
            const staged = accepted.map((file) => toUploadFile(file, uploadsEnabled))
            stagedCountRef.current += staged.length
            setFiles((prev) => [...prev, ...staged])
            if (uploadsEnabled) uploads.enqueue(staged.map((f) => f.uid))
        }
        setRejections(allRejections)
        // Open for rejections too. Otherwise dropping something unsupported writes a message into
        // a closed panel and reads as nothing having happened at all.
        if (accepted.length || allRejections.length) setAttachmentsOpen(true)
    }

    // Removing a chip also aborts its in-flight request.
    const removeFile = (uid: string) => removeUploadFile(uid, uploads.abort, setFiles)

    /**
     * Upload files that never entered the tray (a voice take sent outright) and return their staged
     * entries. A failure adopts them into the tray so the error is visible and retryable, and
     * returns null so the caller holds the send.
     *
     * These bypass `useAttachmentUploads.run`, so that hook holds no controller for them — this one
     * does, or an unmount (session close, pane swap) would leave them running with nothing able to
     * cancel them.
     *
     * NOTE: unlike `addFiles`, this path uploads regardless of `uploadsEnabled`, while
     * `toUploadFile` marks the same entries settled-without-a-response when the flag is off. Which
     * of the two is right depends on whether a send-time upload is meant to happen during the
     * inline-only rollout — no host calls this yet, so the behavior is left as-is rather than
     * guessed at.
     */
    const uploadExtraFiles = async (extraFiles: File[]): Promise<StagedFile[] | null> => {
        const staged = extraFiles.map((file) => toUploadFile(file, uploadsEnabled))
        const results = await Promise.allSettled(
            staged.map(async (entry) => {
                const controller = new AbortController()
                extraControllers.current.add(controller)
                try {
                    const response = await attachmentUploader(entry.originFileObj as File, {
                        uid: entry.uid,
                        onProgress: () => undefined,
                        signal: controller.signal,
                    })
                    return {...entry, status: "done" as const, percent: 100, response}
                } finally {
                    extraControllers.current.delete(controller)
                }
            }),
        )
        if (results.every((result) => result.status === "fulfilled")) {
            return results.map((result) => (result as PromiseFulfilledResult<StagedFile>).value)
        }
        const settledEntries = results.map((result, index) =>
            result.status === "fulfilled"
                ? result.value
                : {
                      ...staged[index],
                      status: "error" as const,
                      error:
                          result.reason instanceof Error ? result.reason.message : "Upload failed",
                  },
        )
        setFiles((prev) => [...prev, ...settledEntries])
        setAttachmentsOpen(true)
        return null
    }

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

    /** Drop the attachments a send just carried, plus any rejection notice. */
    const clearAttachments = (consumedUids: string[]) => {
        // Only what this send carried: anything staged while it was in flight belongs to the next message.
        setFiles((prev) => prev.filter((file) => !consumedUids.includes(file.uid)))
        setRejections([])
        setAttachmentsOpen(false)
    }

    /**
     * Put back what a send consumed when that send did not go through — a hand-off whose
     * navigation failed, say. The entries are already uploaded, so they return settled rather
     * than through `addFiles`, which would re-upload them as second attachments. Idempotent:
     * anything already back in the tray is left where it is.
     */
    const restoreAttachments = (restored: StagedFile[]) => {
        setFiles((prev) => [
            ...restored.filter((file) => !prev.some((row) => row.uid === file.uid)),
            ...prev,
        ])
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
        uploadBlockReason,
        isDragging,
        addFiles,
        removeFile,
        uploadExtraFiles,
        uploads,
        clearAttachments,
        restoreAttachments,
        bindDropTarget,
    }
}
