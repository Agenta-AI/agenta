import {useCallback, useEffect, useRef} from "react"

import type {UploadFile} from "antd"

/**
 * Owns the per-attachment upload lifecycle, expressed on antd's `UploadFile` fields so the tray
 * renders straight off them: `status` (`uploading` | `done` | `error`), `percent`, and `error`
 * (a message). Everything is driven through here so the transport is the ONLY thing left to wire.
 *
 * `upload` is the seam. Until an upload transport exists it is left undefined: `enqueue` is then a
 * no-op and files stay `done` (ready to send), exactly as today. Provide an `upload` and the whole
 * progress / success / failure / retry flow runs with no other change — the tray already renders
 * every state.
 */
export type AttachmentUploader = (
    file: File,
    ctx: {onProgress: (percent: number) => void; signal: AbortSignal},
) => Promise<void>

export interface AttachmentUploads {
    /** Start (or restart) upload for these uids. No-op without an `upload` transport. */
    enqueue: (uids: string[]) => void
    /** Retry one failed upload. */
    retry: (uid: string) => void
}

export function useAttachmentUploads(
    files: UploadFile[],
    setFiles: (updater: (prev: UploadFile[]) => UploadFile[]) => void,
    upload?: AttachmentUploader,
): AttachmentUploads {
    // Read the latest files (for the File blob) without making `run` depend on every list change.
    const filesRef = useRef(files)
    filesRef.current = files
    const controllers = useRef(new Map<string, AbortController>())

    const patch = useCallback(
        (uid: string, next: Partial<UploadFile>) => {
            setFiles((prev) => prev.map((f) => (f.uid === uid ? {...f, ...next} : f)))
        },
        [setFiles],
    )

    const run = useCallback(
        (uid: string) => {
            if (!upload) return
            const file = filesRef.current.find((f) => f.uid === uid)?.originFileObj as
                | File
                | undefined
            if (!file) return

            controllers.current.get(uid)?.abort()
            const controller = new AbortController()
            controllers.current.set(uid, controller)

            patch(uid, {status: "uploading", percent: 0, error: undefined})
            upload(file, {
                onProgress: (percent) => patch(uid, {status: "uploading", percent}),
                signal: controller.signal,
            })
                .then(() => {
                    if (controller.signal.aborted) return
                    controllers.current.delete(uid)
                    patch(uid, {status: "done", percent: 100})
                })
                .catch((e: unknown) => {
                    if (controller.signal.aborted) return
                    controllers.current.delete(uid)
                    patch(uid, {
                        status: "error",
                        error: e instanceof Error ? e.message : "Upload failed",
                    })
                })
        },
        [upload, patch],
    )

    const enqueue = useCallback((uids: string[]) => uids.forEach(run), [run])
    const retry = useCallback((uid: string) => run(uid), [run])

    // Abort in-flight uploads on unmount (session switch / pane close).
    useEffect(() => {
        const map = controllers.current
        return () => map.forEach((c) => c.abort())
    }, [])

    return {enqueue, retry}
}

/** Aggregate upload state for composer-level messaging and send-gating. */
export interface AttachmentUploadSummary {
    uploading: number
    failed: number
    /** True while any upload is in flight — send should wait. */
    busy: boolean
}

export const summarizeUploads = (files: UploadFile[]): AttachmentUploadSummary => {
    const uploading = files.filter((f) => f.status === "uploading").length
    const failed = files.filter((f) => f.status === "error").length
    return {uploading, failed, busy: uploading > 0}
}
