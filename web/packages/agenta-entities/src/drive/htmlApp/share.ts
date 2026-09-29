/** App sharing: owner calls, the one-request snapshot, and its read-only `FsClient`. */

import {getMountsClient, getSharedAppsClient} from "@agenta/sdk/resources"
import {z} from "zod"

import {projectScopedRequest} from "@agenta/entities/session"

import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {cleanPath} from "../driveTree"

import {FsClientError, type FsClient} from "./fsClient"
import type {FileEntry} from "./protocol"

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

export const shareVisibilitySchema = z.enum(["workspace", "link"])
export type ShareVisibility = z.infer<typeof shareVisibilitySchema>

const shareStateSchema = z.object({
    enabled: z.boolean(),
    visibility: shareVisibilitySchema,
    created_at: z.string(),
    updated_at: z.string(),
    token: z.string().nullish(),
})

const shareIssueSchema = z.object({
    code: z.string().nullish(),
    url: z.string().nullish(),
    path: z.string().nullish(),
    reason: z.string().nullish(),
})
export type AppShareIssue = z.infer<typeof shareIssueSchema>

const shareResponseSchema = z.object({
    share: shareStateSchema.nullish(),
    external_failed: z.array(shareIssueSchema).nullish(),
    warnings: z.array(shareIssueSchema).nullish(),
})
export type AppShareResult = z.infer<typeof shareResponseSchema>

const sharedFileSchema = z.object({
    content_type: z.string(),
    size: z.number(),
    data: z.string(),
})

const sharedAppSchema = z.object({
    name: z.string(),
    entry: z.string(),
    kit: z.boolean().nullish(),
    visibility: shareVisibilitySchema,
    author_name: z.string().nullish(),
    viewer: z.object({
        role: z.enum(["anonymous", "member", "project_member", "editor"]),
        is_owner: z.boolean().nullish(),
        can_open_session: z.boolean().nullish(),
        session_id: z.string().nullish(),
        agent_id: z.string().nullish(),
        workspace_id: z.string().nullish(),
        project_id: z.string().nullish(),
        mount_id: z.string().nullish(),
        app_path: z.string().nullish(),
    }),
    refs: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string()))).nullish(),
    files: z.record(z.string(), sharedFileSchema).nullish(),
    external: z.record(z.string(), sharedFileSchema).nullish(),
    // A file that failed to read after the response started.
    error: z.object({code: z.string(), message: z.string()}).nullish(),
})
export type SharedAppViewer = z.infer<typeof sharedAppSchema>["viewer"]

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** A refused share call, with the server's stable `code` (`share_not_found`, `too_large`, …). */
export class ShareError extends Error {
    readonly code: string
    constructor(code: string, message: string) {
        super(message)
        this.name = "ShareError"
        this.code = code
    }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null

function toShareError(error: unknown): ShareError {
    if (error instanceof ShareError) return error
    const body = isRecord(error) ? error.body : undefined
    const detail = isRecord(body) ? body.detail : undefined
    if (isRecord(detail) && typeof detail.code === "string") {
        const message = typeof detail.message === "string" ? detail.message : detail.code
        return new ShareError(detail.code, message)
    }
    return new ShareError(
        "unavailable",
        typeof detail === "string" ? detail : "The share could not be reached.",
    )
}

// ---------------------------------------------------------------------------------------------
// Owner calls
// ---------------------------------------------------------------------------------------------

interface ShareTarget {
    projectId: string
    mountId: string
    /** Mount-relative app folder. */
    path: string
}

const parseShare = (data: unknown, label: string): AppShareResult => {
    const parsed = safeParseWithLogging(shareResponseSchema, data, label)
    if (!parsed) throw new ShareError("unavailable", "Unexpected share response.")
    return parsed
}

export async function fetchAppShare({projectId, mountId, path}: ShareTarget) {
    try {
        const data = await getMountsClient().fetchAppShare(
            {mount_id: mountId, path},
            projectScopedRequest(projectId),
        )
        return parseShare(data, "[htmlApp.share.fetch]")
    } catch (error) {
        throw toShareError(error)
    }
}

export async function publishAppShare({
    projectId,
    mountId,
    path,
    visibility,
}: ShareTarget & {visibility?: ShareVisibility}) {
    try {
        const data = await getMountsClient().publishAppShare(
            {mount_id: mountId, path, ...(visibility ? {visibility} : {})},
            projectScopedRequest(projectId),
        )
        return parseShare(data, "[htmlApp.share.publish]")
    } catch (error) {
        throw toShareError(error)
    }
}

export async function editAppShare({
    projectId,
    mountId,
    path,
    visibility,
}: ShareTarget & {visibility: ShareVisibility}) {
    try {
        const data = await getMountsClient().editAppShare(
            {mount_id: mountId, path, visibility},
            projectScopedRequest(projectId),
        )
        return parseShare(data, "[htmlApp.share.edit]")
    } catch (error) {
        throw toShareError(error)
    }
}

export async function stopAppShare({projectId, mountId, path}: ShareTarget) {
    try {
        const data = await getMountsClient().stopAppShare(
            {mount_id: mountId, path},
            projectScopedRequest(projectId),
        )
        return parseShare(data, "[htmlApp.share.stop]")
    } catch (error) {
        throw toShareError(error)
    }
}

/** The page a share link opens, relative to the app's own origin (`/m` base path excluded). */
export const sharePagePath = (token: string): string => `/share/${encodeURIComponent(token)}`

// ---------------------------------------------------------------------------------------------
// Viewer: the snapshot
// ---------------------------------------------------------------------------------------------

export interface SnapshotFile {
    contentType: string
    bytes: Uint8Array
    /** Base64 as sent, so a `data:` URI needs no re-encoding. */
    base64: string
}

export interface SharedAppSnapshot {
    name: string
    entry: string
    kit: boolean
    visibility: ShareVisibility
    authorName: string | null
    viewer: SharedAppViewer
    /** App-relative path → file. */
    files: Map<string, SnapshotFile>
    /** Captured URL → file. */
    external: Map<string, SnapshotFile>
    /** Entry key (`file:<path>` | `url:<url>`) → reference as written → `{file}` | `{url}`. */
    refs: Record<string, Record<string, Record<string, string>>>
}

const decodeBase64 = (data: string): Uint8Array => {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

const decodeFiles = (files: Record<string, z.infer<typeof sharedFileSchema>> | null | undefined) =>
    new Map(
        Object.entries(files ?? {}).map(([key, file]) => [
            key,
            {contentType: file.content_type, bytes: decodeBase64(file.data), base64: file.data},
        ]),
    )

/** A shared app in one request; refusals are 403 with a `code`, never 401. */
export async function fetchSharedApp({token}: {token: string}): Promise<SharedAppSnapshot> {
    let data: unknown
    try {
        data = await getSharedAppsClient().fetchSharedApp({token})
    } catch (error) {
        throw toShareError(error)
    }
    const parsed = safeParseWithLogging(sharedAppSchema, data, "[htmlApp.share.view]")
    if (!parsed) throw new ShareError("unavailable", "Unexpected shared app response.")
    if (parsed.error) throw new ShareError(parsed.error.code, parsed.error.message)
    return {
        name: parsed.name,
        entry: parsed.entry,
        kit: parsed.kit ?? true,
        visibility: parsed.visibility,
        authorName: parsed.author_name ?? null,
        viewer: parsed.viewer,
        files: decodeFiles(parsed.files),
        external: decodeFiles(parsed.external),
        refs: parsed.refs ?? {},
    }
}

/** Where `ref`, written in `base` (an app path or a captured URL), points in the snapshot. */
export function resolveSnapshotRef(
    snapshot: Pick<SharedAppSnapshot, "refs">,
    base: string,
    ref: string,
): string | null {
    const entry = snapshot.refs[/^[a-z][a-z0-9+.-]*:/i.test(base) ? `url:${base}` : `file:${base}`]
    const target = entry?.[ref]
    return target?.file ?? target?.url ?? null
}

/** The bytes behind a snapshot key: an app path, or a captured URL. */
export const snapshotFile = (
    snapshot: Pick<SharedAppSnapshot, "files" | "external">,
    key: string,
): SnapshotFile | null => snapshot.files.get(key) ?? snapshot.external.get(key) ?? null

export const snapshotText = (file: SnapshotFile): string => new TextDecoder().decode(file.bytes)

export const snapshotDataUri = (file: SnapshotFile): string =>
    `data:${file.contentType};base64,${file.base64}`

/** A shared app's `window.agenta.fs`: app-relative reads from the snapshot, writes refused. */
export function createSnapshotFsClient(snapshot: Pick<SharedAppSnapshot, "files">): FsClient {
    const readOnly = () =>
        Promise.reject(new FsClientError("read_only", "this shared app is read-only"))
    const notFound = () => new FsClientError("not_found", "no such file")

    const read: FsClient["read"] = async (path) => {
        const file = snapshot.files.get(path)
        if (!file) throw notFound()
        return {result: snapshotText(file), etag: null}
    }

    const list: FsClient["list"] = async (folder) => {
        const prefix = folder === "" ? "" : `${cleanPath(folder)}/`
        const children = new Map<string, FileEntry>()
        for (const [path, file] of snapshot.files) {
            if (!path.startsWith(prefix)) continue
            const rest = path.slice(prefix.length)
            const [head, ...tail] = rest.split("/")
            const childPath = `${prefix}${head}`
            if (tail.length === 0) {
                children.set(childPath, {
                    path: childPath,
                    size: file.bytes.length,
                    mtime: null,
                    etag: null,
                    isFolder: false,
                })
            } else if (!children.has(childPath)) {
                children.set(childPath, {
                    path: childPath,
                    size: 0,
                    mtime: null,
                    etag: null,
                    isFolder: true,
                })
            }
        }
        return {result: [...children.values()].sort((a, b) => (a.path < b.path ? -1 : 1))}
    }

    return {
        read,
        readJSON: async (path) => {
            const {result} = await read(path)
            try {
                return {result: JSON.parse(result) as unknown, etag: null}
            } catch {
                throw new FsClientError("bad_request", "file is not valid JSON")
            }
        },
        write: readOnly,
        writeJSON: readOnly,
        remove: readOnly,
        list,
        exists: async (path) => ({
            result:
                snapshot.files.has(path) ||
                [...snapshot.files.keys()].some((p) => p.startsWith(`${path}/`)),
        }),
        stat: async (path) => {
            const file = snapshot.files.get(path)
            if (!file) throw notFound()
            return {
                result: {path, size: file.bytes.length, mtime: null, etag: null},
                etag: null,
            }
        },
    }
}
