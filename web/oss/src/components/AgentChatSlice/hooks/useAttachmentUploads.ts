import {useCallback, useEffect, useRef} from "react"

import type {UploadFile} from "antd"

/** Owns upload progress, retry, cancellation, and the validated response on each tray entry. */
export type AttachmentUploader<TResponse = unknown> = (
    file: File,
    ctx: {uid: string; onProgress: (percent: number) => void; signal: AbortSignal},
) => Promise<TResponse>

type SetAttachmentFiles<TResponse> = (
    updater: (prev: UploadFile<TResponse>[]) => UploadFile<TResponse>[],
) => void

export interface AttachmentUploads {
    /** Start (or restart) upload for these uids. No-op without an `upload` transport. */
    enqueue: (uids: string[]) => void
    /** Retry one failed upload when its server-provided delay has elapsed. */
    retry: (uid: string) => void
    /** Whether the failed upload should expose a retry action. */
    canRetry: (uid: string) => boolean
    /** Abort and release one in-flight upload. */
    abort: (uid: string) => void
}

interface UploadFailureDetails {
    retryable?: boolean
    retryAfterSeconds?: number
}

const failureDetails = (error: unknown): UploadFailureDetails =>
    error && typeof error === "object" ? (error as UploadFailureDetails) : {}

export const isUploadRetryReady = (retryAt: number | undefined, now = Date.now()): boolean =>
    retryAt === undefined || now >= retryAt

export const removeUploadFile = <TResponse>(
    uid: string,
    abort: (uid: string) => void,
    setFiles: SetAttachmentFiles<TResponse>,
): void => {
    abort(uid)
    setFiles((prev) => prev.filter((file) => file.uid !== uid))
}

export function useAttachmentUploads<TResponse>(
    files: UploadFile<TResponse>[],
    setFiles: SetAttachmentFiles<TResponse>,
    upload?: AttachmentUploader<TResponse>,
): AttachmentUploads {
    // Read the latest files (for the File blob) without making `run` depend on every list change.
    const filesRef = useRef(files)
    filesRef.current = files
    const controllers = useRef(new Map<string, AbortController>())
    const queued = useRef(new Set<string>())
    const retryAt = useRef(new Map<string, number>())
    const retryable = useRef(new Map<string, boolean>())
    const retryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

    const patch = useCallback(
        (uid: string, next: Partial<UploadFile<TResponse>>) => {
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
            retryAt.current.delete(uid)
            retryable.current.delete(uid)

            clearTimeout(retryTimers.current.get(uid))
            retryTimers.current.delete(uid)

            const release = () => {
                if (controllers.current.get(uid) === controller) controllers.current.delete(uid)
            }

            patch(uid, {status: "uploading", percent: 0, error: undefined})
            upload(file, {
                uid,
                onProgress: (percent) => patch(uid, {status: "uploading", percent}),
                signal: controller.signal,
            })
                .then((response) => {
                    if (controller.signal.aborted) return
                    release()
                    patch(uid, {status: "done", percent: 100, response})
                })
                .catch((error: unknown) => {
                    if (controller.signal.aborted) return
                    release()
                    const details = failureDetails(error)
                    retryable.current.set(uid, details.retryable !== false)
                    if (details.retryAfterSeconds !== undefined) {
                        retryAt.current.set(uid, Date.now() + details.retryAfterSeconds * 1000)
                    }
                    patch(uid, {
                        status: "error",
                        error: error instanceof Error ? error.message : "Upload failed",
                    })
                })
        },
        [upload, patch],
    )

    const abort = useCallback((uid: string) => {
        queued.current.delete(uid)
        retryAt.current.delete(uid)
        retryable.current.delete(uid)
        clearTimeout(retryTimers.current.get(uid))
        retryTimers.current.delete(uid)
        const controller = controllers.current.get(uid)
        controllers.current.delete(uid)
        controller?.abort()
    }, [])
    const enqueue = useCallback((uids: string[]) => {
        uids.forEach((uid) => queued.current.add(uid))
    }, [])
    useEffect(() => {
        // A remounted tray resumes in-flight entries with the same uid/idempotency key.
        for (const file of files) {
            if (
                file.status === "uploading" &&
                file.originFileObj &&
                !controllers.current.has(file.uid)
            ) {
                queued.current.add(file.uid)
            }
        }
        for (const uid of queued.current) {
            if (!files.some((file) => file.uid === uid)) continue
            queued.current.delete(uid)
            run(uid)
        }
    }, [files, run])
    const retry = useCallback(
        (uid: string) => {
            if (retryable.current.get(uid) === false) return
            const allowedAt = retryAt.current.get(uid)
            if (!isUploadRetryReady(allowedAt)) {
                clearTimeout(retryTimers.current.get(uid))
                retryTimers.current.set(
                    uid,
                    setTimeout(
                        () => {
                            retryTimers.current.delete(uid)
                            run(uid)
                        },
                        Math.max(0, (allowedAt ?? Date.now()) - Date.now()),
                    ),
                )
                return
            }
            run(uid)
        },
        [run],
    )
    const canRetry = useCallback((uid: string) => retryable.current.get(uid) !== false, [])

    // Abort in-flight uploads on unmount (session switch / pane close).
    useEffect(() => {
        const map = controllers.current
        return () => {
            map.forEach((controller) => controller.abort())
            map.clear()
            retryTimers.current.forEach((timer) => clearTimeout(timer))
            retryTimers.current.clear()
        }
    }, [])

    return {enqueue, retry, canRetry, abort}
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
