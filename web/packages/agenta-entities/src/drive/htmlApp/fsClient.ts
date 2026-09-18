/**
 * Agent HTML apps — the eight `window.agenta.fs` operations against the mounts API (lane A).
 *
 * Paths here are MOUNT-relative (the host has already resolved the app dir and scope). The client
 * knows nothing about grants or the etag cache: the host passes `ifMatch` explicitly and reads
 * the etag back from every result. Failures throw {@link FsClientError} carrying the bridge code:
 *
 *   404 → not_found · 412 → conflict (with the server's current etag from `detail.etag`) ·
 *   413 or a local cap breach → too_large · 403 → read_only · anything else → unavailable.
 *
 * Transport: reads, listings and deletes go through the Fern mounts client (`deleteMountFile`
 * takes `If-Match` as its typed `if-match` request field). The generated `writeMountFile`
 * sends NO body, so `write` uses the shared axios instance with a raw `text/plain` body — the same
 * path `driveMedia` uses for bytes.
 */

import {getMountsClient} from "@agenta/sdk/resources"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {z} from "zod"

import {projectScopedRequest} from "@agenta/entities/session"

import {safeParseWithLogging} from "../../shared/utils/zodSchema"

import {
    READ_CAP,
    WRITE_CAP,
    type BridgeErrorCode,
    type FileEntry,
    type FileStat,
    type FsResults,
} from "./protocol"

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface FsClientOptions {
    mountId: string
    projectId: string
}

/** Per-call options for write/remove: the implicit If-Match the host resolved. */
export interface FsWriteOptions {
    ifMatch?: string | null
}

/** A successful result plus the etag of the path afterwards (when the server reports one). */
export interface FsClientResult<M extends keyof FsResults> {
    result: FsResults[M]
    etag?: string | null
}

export interface FsClient {
    read(path: string): Promise<FsClientResult<"read">>
    readJSON(path: string): Promise<FsClientResult<"readJSON">>
    write(path: string, body: string, opts?: FsWriteOptions): Promise<FsClientResult<"write">>
    writeJSON(
        path: string,
        body: string,
        opts?: FsWriteOptions,
    ): Promise<FsClientResult<"writeJSON">>
    /** Direct children of `folder` (`""` = mount root); entry paths are mount-relative. */
    list(folder: string): Promise<FsClientResult<"list">>
    exists(path: string): Promise<FsClientResult<"exists">>
    stat(path: string): Promise<FsClientResult<"stat">>
    remove(path: string, opts?: FsWriteOptions): Promise<FsClientResult<"remove">>
}

export class FsClientError extends Error {
    readonly code: BridgeErrorCode
    /** On `conflict`: the etag the server holds now (null when the file is gone). */
    readonly etag?: string | null
    readonly status?: number

    constructor(
        code: BridgeErrorCode,
        message: string,
        extra?: {etag?: string | null; status?: number},
    ) {
        super(message)
        this.name = "FsClientError"
        this.code = code
        if (extra && "etag" in extra) this.etag = extra.etag
        if (extra?.status !== undefined) this.status = extra.status
    }
}

export const isFsClientError = (x: unknown): x is FsClientError =>
    x instanceof FsClientError ||
    (typeof x === "object" && x !== null && (x as FsClientError).name === "FsClientError")

// ---------------------------------------------------------------------------------------------
// Boundary schemas (etag stays optional: folders and older objects carry none)
// ---------------------------------------------------------------------------------------------

const etagSchema = z.string().nullish()

const readResponseSchema = z.object({
    path: z.string().nullish(),
    content: z.string(),
    etag: etagSchema,
})

const listEntrySchema = z.object({
    path: z.string(),
    size: z.number().nullish(),
    is_folder: z.boolean().nullish(),
    mtime: z.number().nullish(),
    etag: etagSchema,
})

const listResponseSchema = z.object({
    files: z.array(listEntrySchema).nullish(),
})

const writeResponseSchema = z.object({
    path: z.string().nullish(),
    size: z.number().nullish(),
    etag: etagSchema,
})

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const MESSAGES: Record<BridgeErrorCode, string> = {
    scope: "path is outside the app directory",
    read_only: "app has read-only access",
    not_found: "no such file",
    conflict: "file changed since it was last read",
    too_large: "payload exceeds the size cap",
    unavailable: "the drive is unavailable",
    bad_request: "malformed request",
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null

/** HTTP status from a Fern `AgentaApiError` (`statusCode`) or an axios error (`response.status`). */
const statusOf = (error: unknown): number | undefined => {
    if (!isRecord(error)) return undefined
    if (typeof error.statusCode === "number") return error.statusCode
    const response = error.response
    if (isRecord(response) && typeof response.status === "number") return response.status
    return undefined
}

/** Response body from a Fern error (`body`) or an axios error (`response.data`). */
const bodyOf = (error: unknown): unknown => {
    if (!isRecord(error)) return undefined
    if ("body" in error) return error.body
    const response = error.response
    return isRecord(response) ? response.data : undefined
}

/** `{"detail": {"code": "conflict", "etag": <current or null>}}` → the etag, null when absent. */
const conflictEtag = (body: unknown): string | null => {
    if (!isRecord(body)) return null
    const detail = body.detail
    if (!isRecord(detail)) return null
    return typeof detail.etag === "string" ? detail.etag : null
}

/** Map a transport failure onto a bridge error. Never throws anything but {@link FsClientError}. */
export function toFsClientError(error: unknown): FsClientError {
    if (isFsClientError(error)) return error
    const status = statusOf(error)
    switch (status) {
        case 404:
            return new FsClientError("not_found", MESSAGES.not_found, {status})
        case 412:
            return new FsClientError("conflict", MESSAGES.conflict, {
                status,
                etag: conflictEtag(bodyOf(error)),
            })
        case 413:
            return new FsClientError("too_large", MESSAGES.too_large, {status})
        case 403:
            return new FsClientError("read_only", MESSAGES.read_only, {status})
        default: {
            const message =
                error instanceof Error && error.message ? error.message : MESSAGES.unavailable
            return new FsClientError("unavailable", message, status === undefined ? {} : {status})
        }
    }
}

const parentOf = (path: string): string => {
    const i = path.lastIndexOf("/")
    return i < 0 ? "" : path.slice(0, i)
}

const toEntry = (entry: z.infer<typeof listEntrySchema>): FileEntry => {
    const isFolder = entry.is_folder === true
    return {
        path: entry.path.replace(/\/+$/, ""),
        size: entry.size ?? 0,
        mtime: entry.mtime ?? null,
        etag: isFolder ? null : (entry.etag ?? null),
        isFolder,
    }
}

const toStat = (entry: FileEntry): FileStat => ({
    path: entry.path,
    size: entry.size,
    mtime: entry.mtime,
    etag: entry.etag ?? null,
})

const ifMatchHeaders = (opts?: FsWriteOptions): Record<string, string> =>
    typeof opts?.ifMatch === "string" ? {"If-Match": opts.ifMatch} : {}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------

export function createFsClient({mountId, projectId}: FsClientOptions): FsClient {
    const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
        try {
            return await fn()
        } catch (error) {
            throw toFsClientError(error)
        }
    }

    const read: FsClient["read"] = (path) =>
        guarded(async () => {
            const data = await getMountsClient().getMountFiles(
                {mount_id: mountId, read: path},
                projectScopedRequest(projectId),
            )
            const parsed = safeParseWithLogging(readResponseSchema, data, "[htmlApp.fs.read]")
            if (!parsed) throw new FsClientError("unavailable", "unexpected read response")
            if (byteLength(parsed.content) > READ_CAP) {
                throw new FsClientError("too_large", MESSAGES.too_large)
            }
            return {result: parsed.content, etag: parsed.etag ?? null}
        })

    const readJSON: FsClient["readJSON"] = async (path) => {
        const {result, etag} = await read(path)
        try {
            return {result: JSON.parse(result) as unknown, etag}
        } catch {
            throw new FsClientError("bad_request", "file is not valid JSON")
        }
    }

    const list: FsClient["list"] = (folder) =>
        guarded(async () => {
            let data: unknown
            try {
                data = await getMountsClient().getMountFiles(
                    {mount_id: mountId, path: folder === "" ? undefined : folder, depth: 1},
                    projectScopedRequest(projectId),
                )
            } catch (error) {
                // A folder that does not exist lists as empty (mock parity), not as an error.
                if (statusOf(error) === 404) return {result: []}
                throw error
            }
            const parsed = safeParseWithLogging(listResponseSchema, data, "[htmlApp.fs.list]")
            if (!parsed) throw new FsClientError("unavailable", "unexpected list response")
            const prefix = folder === "" ? "" : `${folder.replace(/\/+$/, "")}/`
            return {
                result: (parsed.files ?? [])
                    .map(toEntry)
                    .filter((entry) => entry.path !== "" && entry.path.startsWith(prefix))
                    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
            }
        })

    const findEntry = async (path: string): Promise<FileEntry | null> => {
        const {result} = await list(parentOf(path))
        return result.find((entry) => entry.path === path) ?? null
    }

    const exists: FsClient["exists"] = async (path) => ({result: (await findEntry(path)) !== null})

    const stat: FsClient["stat"] = async (path) => {
        const entry = await findEntry(path)
        // Folders are not stat-able (mock parity): only files carry a size and an etag.
        if (!entry || entry.isFolder) throw new FsClientError("not_found", MESSAGES.not_found)
        return {result: toStat(entry), etag: entry.etag ?? null}
    }

    const write: FsClient["write"] = (path, body, opts) =>
        guarded(async () => {
            const size = byteLength(body)
            if (size > WRITE_CAP) throw new FsClientError("too_large", MESSAGES.too_large)
            const url = `${getAgentaApiUrl()}/mounts/${mountId}/files?path=${encodeURIComponent(path)}`
            const response = await axios.put(url, body, {
                params: {project_id: projectId},
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    ...ifMatchHeaders(opts),
                },
            })
            const parsed = safeParseWithLogging(
                writeResponseSchema,
                response.data,
                "[htmlApp.fs.write]",
            )
            const etag = parsed?.etag ?? null
            return {
                result: {path: parsed?.path ?? path, size: parsed?.size ?? size, etag},
                etag,
            }
        })

    const writeJSON: FsClient["writeJSON"] = async (path, body, opts) => {
        try {
            JSON.parse(body)
        } catch {
            throw new FsClientError("bad_request", "body is not valid JSON")
        }
        const {result, etag} = await write(path, body, opts)
        return {result, etag}
    }

    const remove: FsClient["remove"] = (path, opts) =>
        guarded(async () => {
            await getMountsClient().deleteMountFile(
                {
                    mount_id: mountId,
                    path,
                    ...(typeof opts?.ifMatch === "string" ? {"if-match": opts.ifMatch} : {}),
                },
                projectScopedRequest(projectId),
            )
            return {result: {deleted: true}}
        })

    return {read, readJSON, write, writeJSON, list, exists, stat, remove}
}
