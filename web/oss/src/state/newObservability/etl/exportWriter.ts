/**
 * createExportWriter — choose the lowest-memory CSV writer the browser
 * supports.
 *
 *   - Chromium browsers expose the File System Access API
 *     (`window.showSaveFilePicker`). We open a writable file stream and
 *     hand each batch directly to disk — memory stays bounded by one batch.
 *   - Safari / Firefox fall back to the legacy `BlobPart[]` accumulator
 *     + anchor-click download, exactly matching the previous behavior.
 *
 * The caller doesn't need to know which path it got — it writes encoded
 * chunks, then calls `finalize(rowCount)` on success or `abort()` on
 * failure / cancel. `finalize(0)` is a clean no-op in the buffered path
 * and aborts the streaming writable so a header-only file isn't left on
 * disk.
 */

import Papa from "papaparse"

import {downloadCsv} from "@/oss/lib/helpers/fileManipulations"

/**
 * Subset of `FileSystemWritableFileStream` we actually call. Declared
 * locally to keep the runtime feature-detect honest — the global type
 * isn't available in every browser's typings even when the runtime supports
 * it (and the buffered path doesn't need any of this).
 */
interface WritableFileStreamLike {
    write(chunk: BlobPart): Promise<void>
    close(): Promise<void>
    abort(reason?: unknown): Promise<void>
}

/** Subset of `FileSystemFileHandle` we use. */
interface FileSystemFileHandleLike {
    createWritable(): Promise<WritableFileStreamLike>
}

/** Subset of `window.showSaveFilePicker` (and its options) we rely on. */
interface ShowSaveFilePickerOptions {
    suggestedName?: string
    types?: {
        description?: string
        accept: Record<string, string[]>
    }[]
}
type ShowSaveFilePicker = (options?: ShowSaveFilePickerOptions) => Promise<FileSystemFileHandleLike>

/** Sentinel returned when the user cancels the native file picker. */
export const PICKER_CANCELLED = "cancelled" as const

/** The writer protocol consumed by `ObservabilityHeader.onExport`. */
export interface ExportWriter {
    /** Streaming (disk) or buffered (in-memory)? Surfaced for telemetry / debug. */
    kind: "stream" | "buffer"
    /** Append one pre-encoded chunk. */
    write(chunk: BlobPart): Promise<void>
    /**
     * Commit the export. `rowCount === 0` discards the file (or skips the
     * download) so no empty / header-only artifact is produced.
     */
    finalize(rowCount: number): Promise<void>
    /** Discard partial data on cancel / error. Safe to call multiple times. */
    abort(): Promise<void>
}

const getShowSaveFilePicker = (): ShowSaveFilePicker | undefined => {
    if (typeof window === "undefined") return undefined
    const picker = (window as unknown as {showSaveFilePicker?: ShowSaveFilePicker})
        .showSaveFilePicker
    return typeof picker === "function" ? picker : undefined
}

const CSV_FILE_TYPE = {
    description: "CSV file",
    accept: {"text/csv": [".csv"]},
}

/**
 * Build a writer for the current browser, prompting the user for a save
 * location upfront on Chromium-class browsers. Returns `PICKER_CANCELLED`
 * if the user dismisses the native file picker — the call site should bail
 * before starting the scan.
 */
export const createExportWriter = async ({
    filename,
    headers,
}: {
    filename: string
    headers: string[]
}): Promise<ExportWriter | typeof PICKER_CANCELLED> => {
    const csvHeader = Papa.unparse({fields: headers, data: []})

    // ─── Streaming path ──────────────────────────────────────────────────
    // The File System Access API materializes the file at `createWritable`
    // time. Header is written eagerly so the writer is in a known state
    // before the first scan page lands.
    const showSaveFilePicker = getShowSaveFilePicker()
    if (showSaveFilePicker) {
        let handle: FileSystemFileHandleLike
        try {
            handle = await showSaveFilePicker({
                suggestedName: filename,
                types: [CSV_FILE_TYPE],
            })
        } catch (err) {
            // User dismissed the picker — bail entirely, the scan never starts.
            if ((err as Error)?.name === "AbortError") return PICKER_CANCELLED
            // Permissions / other failures: fall through to the buffered path
            // so the export still works.

            console.warn("[export] showSaveFilePicker failed, falling back to Blob:", err)
            handle = null as unknown as FileSystemFileHandleLike
        }

        if (handle) {
            try {
                const writable = await handle.createWritable()
                await writable.write(csvHeader)
                let aborted = false
                return {
                    kind: "stream",
                    write: (chunk) => writable.write(chunk),
                    finalize: async (rowCount) => {
                        if (aborted) return
                        if (rowCount > 0) {
                            await writable.close()
                        } else {
                            // No matching rows — discard the header-only file
                            // so the user doesn't end up with an empty artifact
                            // they didn't intend to keep.
                            aborted = true
                            await writable.abort()
                        }
                    },
                    abort: async () => {
                        if (aborted) return
                        aborted = true
                        try {
                            await writable.abort()
                        } catch {
                            // Best-effort cleanup — closing a stream that
                            // already errored throws, but the partial file is
                            // already gone.
                        }
                    },
                }
            } catch (err) {
                // createWritable() can fail with permissions errors — fall
                // through to the buffered path so the export still works.

                console.warn("[export] createWritable failed, falling back to Blob:", err)
            }
        }
    }

    // ─── Buffered fallback ───────────────────────────────────────────────
    // Same shape as the previous `fetchAllTracesForExport` accumulator: hold
    // all CSV chunks in JS heap, assemble a Blob, anchor-download at the end.
    const csvParts: BlobPart[] = [csvHeader]
    let aborted = false
    return {
        kind: "buffer",
        write: async (chunk) => {
            if (aborted) return
            csvParts.push(chunk)
        },
        finalize: async (rowCount) => {
            if (aborted) return
            if (rowCount > 0) downloadCsv(csvParts, filename)
            // 0 rows: matches the legacy "No traces to export" path — no
            // download, no file artifact, the caller surfaces the toast.
        },
        abort: async () => {
            aborted = true
            csvParts.length = 0
        },
    }
}
