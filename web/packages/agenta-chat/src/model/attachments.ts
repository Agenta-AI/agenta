import {generateId} from "@agenta/shared/utils"

/** A file staged for upload before it's sent — neutral shape, independent of the desktop
 * upload-item type. */
export interface PendingAttachment {
    file: File
    uid: string
    name: string
}

// Unique per staged ROW, not per file identity: a name-mtime-size key collided whenever the
// same file was attached twice (paste then drop) — one remove then wiped both rows. Mirrors
// the desktop composer's fix.
export const toPendingAttachment = (file: File): PendingAttachment => ({
    file,
    uid: `att-${generateId()}`,
    name: file.name,
})

/**
 * A file moving through (or done with) the upload pipeline — the neutral replacement for the
 * antd `UploadFile` shape the desktop tray used. Only the fields the pipeline actually reads.
 */
export interface StagedUpload<TResponse = unknown> {
    /** Unique per staged ROW (the tray's React key, remove/retry handle, upload idempotency key). */
    uid: string
    name: string
    status?: "uploading" | "done" | "error"
    /** Upload progress 0–100 while `status === "uploading"`. */
    percent?: number
    /** The live browser File backing the row (absent on replayed/serialized entries). */
    originFileObj?: File
    /** Server response once the upload settled. */
    response?: TResponse
    error?: unknown
    /** Mirror of the File's media type/size, for rows whose blob is gone. */
    type?: string
    size?: number
}
