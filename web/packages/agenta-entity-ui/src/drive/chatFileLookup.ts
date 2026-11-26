/** Chat file mention lookups shared by links and inline previews; not exported from the index. */
import {useCallback} from "react"

import {
    AGENT_FILES_DIR,
    agentDrivesStateAtom,
    cleanPath,
    resolveDriveFileKind,
    resolveDrivePath,
} from "@agenta/entities/drive"
import {
    drivePathFromToolPath,
    pickCwdMount,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    type Mount,
} from "@agenta/entities/session"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

import {useDriveRevisionId} from "./driveSessionContext"
import {isSvgPath} from "./svgPreview"

/** Longest side of an inline chat image preview: sharp at 320 CSS px on a 2x screen. */
export const CHAT_IMAGE_PREVIEW_PX = 720

/** An image `createImageBitmap` can downscale; SVG previews from its text instead. */
export const isRasterImage = (candidate: string): boolean =>
    resolveDriveFileKind(candidate) === "image" && !isSvgPath(candidate)

/** An image the reply can show inline: a raster thumbnail or an SVG. */
export const isInlineImage = (candidate: string): boolean =>
    resolveDriveFileKind(candidate) === "image"

/** Basenames of every file the agent wrote/edited (from records) → the tool paths sharing them, for
 * a cheap "does a written file tail-match this mention" test (records paths are tool paths — absolute
 * or cwd-relative — so we match on the tail, not by equality). */
export const recordIndexAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const recency = get(sessionRecordFileRecencyAtomFamily(sessionId))
        const byBasename = new Map<string, string[]>()
        for (const toolPath of recency.keys()) {
            const base = toolPath.replace(/\/+$/, "").split("/").pop() ?? ""
            if (!base) continue
            const arr = byBasename.get(base)
            if (arr) arr.push(toolPath)
            else byBasename.set(base, [toolPath])
        }
        return byBasename
    }),
)

const inAgentFiles = (rel: string) =>
    rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`)

/** A mention's mount and mount-relative path, given the session's cwd mount, home drive, the
 * drives linked at `drives/<slug>/` (the home included) and every configured drive. A path in a
 * configured drive that has no mount opens nothing, never the session folder's link. */
export function resolveMentionMount<M>(
    path: string,
    cwdMount: M | null | undefined,
    homeMount: M | null | undefined,
    linked: readonly {slug: string; mount: M}[] = [],
    entries: readonly {slug: string}[] = linked,
): {mount: M; path: string} | null {
    // `undefined`: not a drive path.
    const inDrive = (rel: string) => {
        const hit = resolveDrivePath(rel, linked)
        if (hit) return {mount: hit.drive.mount, path: hit.path}
        return resolveDrivePath(rel, entries) ? null : undefined
    }
    // The path as written first. The markdown sanitizer hands `agent-files/x` back as
    // `/agent-files/x`, which names the home drive, never a sandbox path (#7715).
    const written = cleanPath(path)
    if (homeMount && inAgentFiles(written))
        return {mount: homeMount, path: written.slice(AGENT_FILES_DIR.length + 1)}
    const writtenDrive = inDrive(written)
    if (writtenDrive !== undefined) return writtenDrive
    // Then a full sandbox path, with its mount root stripped.
    const tool = path.startsWith("/") ? drivePathFromToolPath(path) : null
    if (tool?.origin === "agent") return homeMount ? {mount: homeMount, path: tool.path} : null
    if (tool?.origin === "drive") {
        const drive = linked.find((d) => d.slug === tool.slug)
        return drive ? {mount: drive.mount, path: tool.path} : null
    }
    const rel = cleanPath(tool?.path ?? path)
    if (homeMount && inAgentFiles(rel))
        return {mount: homeMount, path: rel.slice(AGENT_FILES_DIR.length + 1)}
    const relDrive = inDrive(rel)
    if (relDrive !== undefined) return relDrive
    return cwdMount ? {mount: cwdMount, path: rel} : null
}

/** A mention's mount and mount-relative path, from the mount lists only (no file listing). */
export function useMountResolver(sessionId: string, artifactId?: string | null) {
    const cwdMounts = useAtomValue(sessionMountsQueryFamily(sessionId)).data ?? []
    const cwdMount = pickCwdMount(cwdMounts)
    const {homeMount, linked, entries} = useAtomValue(
        agentDrivesStateAtom(useDriveRevisionId(), artifactId),
    )
    return useCallback(
        (path: string): {mount: Mount; path: string} | null =>
            resolveMentionMount(path, cwdMount, homeMount, linked, entries),
        [cwdMount, homeMount, linked, entries],
    )
}
