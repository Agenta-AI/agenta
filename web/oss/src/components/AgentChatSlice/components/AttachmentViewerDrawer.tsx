import {useEffect, useMemo, useState} from "react"

import {type MountFile} from "@agenta/entities/session"
import type {UploadFile} from "antd"

import {type DriveFileSource, DriveFileSourceContext} from "@/oss/components/Drives/driveFileSource"
import {FilesDrawer} from "@/oss/components/Drives/FilesDrawer"
import {type SessionDriveData} from "@/oss/components/Drives/useSessionDrive"

/**
 * Previews the composer's attachments in the shared Files drawer — the same tree + viewer used for
 * agent files — instead of a parallel viewer. The files are local in-memory blobs, so it hands the
 * drawer an explicit file list plus a `DriveFileSourceContext` that resolves bytes from object URLs
 * (see `DriveExplorer` `explicitFiles` and `driveFileSource`).
 */

/** A file kind the drawer can actually preview; audio plays inline in the tray instead. */
const isViewable = (mediaType: string): boolean =>
    mediaType.startsWith("image/") ||
    mediaType === "application/pdf" ||
    mediaType.startsWith("text/") ||
    mediaType === "application/json"

const EXT_FOR_TYPE: Record<string, string> = {
    "application/pdf": "pdf",
    "application/json": "json",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}

const extForType = (type: string): string => {
    if (EXT_FOR_TYPE[type]) return EXT_FOR_TYPE[type]
    const [group, sub] = type.split("/")
    if (group === "image" || group === "audio" || group === "video") return sub || group
    return ""
}

/** Kind resolution keys on the extension, so give a name that lacks one one derived from its type. */
const withExtension = (name: string, type: string): string => {
    if (/\.[^./]+$/.test(name)) return name
    const ext = extForType(type)
    return ext ? `${name}.${ext}` : name
}

const dedupe = (name: string, seen: Map<string, number>): string => {
    const n = seen.get(name) ?? 0
    seen.set(name, n + 1)
    if (n === 0) return name
    const dot = name.lastIndexOf(".")
    return dot > 0 ? `${name.slice(0, dot)}-${n + 1}${name.slice(dot)}` : `${name}-${n + 1}`
}

interface BuiltNodes {
    files: MountFile[]
    source: DriveFileSource
    /** Composer uid → the path we present it under, so a click can open the drawer onto it. */
    pathByUid: Map<string, string>
}

const buildNodes = (uploads: UploadFile[]): BuiltNodes => {
    const seen = new Map<string, number>()
    const files: MountFile[] = []
    const source: DriveFileSource = new Map()
    const pathByUid = new Map<string, string>()

    for (const upload of uploads) {
        const file = upload.originFileObj as File | undefined
        if (!file) continue
        const path = dedupe(withExtension(upload.name || file.name || "file", file.type), seen)
        files.push({path, size: file.size, is_folder: false})
        source.set(path, {file, objectUrl: URL.createObjectURL(file)})
        pathByUid.set(upload.uid, path)
    }
    return {files, source, pathByUid}
}

const AttachmentViewerDrawer = ({
    uploads,
    openUid,
    onClose,
}: {
    uploads: UploadFile[]
    /** The attachment being viewed, or null when the drawer is closed. */
    openUid: string | null
    onClose: () => void
}) => {
    const open = openUid !== null

    // Build (and own the object URLs of) the node set only while open, revoking on close/change.
    const [nodes, setNodes] = useState<BuiltNodes | null>(null)
    useEffect(() => {
        if (!open) {
            setNodes(null)
            return
        }
        const built = buildNodes(uploads)
        setNodes(built)
        return () => built.source.forEach((v) => URL.revokeObjectURL(v.objectUrl))
    }, [open, uploads])

    // Local mode: no mount, so nothing resolves to a download; bytes come from the context.
    const drive = useMemo<SessionDriveData>(
        () => ({
            mount: null,
            files: nodes?.files ?? [],
            fileCount: nodes?.files.length ?? 0,
            totalSize: 0,
            recents: [],
            lastTouchedAt: null,
            summary: "",
            isLoading: false,
            errored: false,
            resolveMount: () => null,
        }),
        [nodes],
    )

    return (
        <DriveFileSourceContext.Provider value={nodes?.source ?? null}>
            <FilesDrawer
                open={open}
                onClose={onClose}
                drive={drive}
                explicitFiles={nodes?.files ?? []}
                initialPath={openUid ? (nodes?.pathByUid.get(openUid) ?? null) : null}
            />
        </DriveFileSourceContext.Provider>
    )
}

export {isViewable}
export default AttachmentViewerDrawer
