import {useCallback} from "react"

import {
    AGENT_FILES_DIR,
    DRIVES_DIR,
    presentToolPath,
    useSessionDrive,
    type ResolvedMountPath,
} from "@agenta/entities/drive"
import {
    drivePathFromToolPath,
    mountPathMatchesToolPath,
    type MountFile,
} from "@agenta/entities/session"

import {useDriveArtifactId, useDriveRevisionId, useDriveSessionId} from "./driveSessionContext"

export interface DriveFileLookup {
    /** The listing's entry for a tool path; null when the listing does not have it (yet). */
    entry: MountFile | null
    /** The mount and mount-relative path that read or download it. */
    target: ResolvedMountPath | null
}

/**
 * The listing's entry for a path. `exact` takes a drive path as is. A tool path in a drive (under
 * its own mount, or through the session folder's `drives/<slug>/` link) names that drive's
 * presented path, never a session file that shares its tail. Any other tool path matches on its tail, and the longest matching path
 * wins, so `drives/prices/a.md` never resolves to a shorter `a.md` that only shares its tail.
 */
export const findDriveEntry = <F extends {path: string}>(
    files: readonly F[],
    path: string,
    exact = false,
    homeSlug: string | null = null,
    homePrefix = `${AGENT_FILES_DIR}/`,
): F | null => {
    const byPath = (p: string) => files.find((file) => file.path === p) ?? null
    if (exact) return byPath(path)
    // A drive's file, by its own mount or through the session folder's link, is looked up exactly.
    const tool = drivePathFromToolPath(path)
    if (tool) {
        const presented = presentToolPath(tool, homeSlug, homePrefix)
        if (
            tool.origin !== "session" ||
            presented !== tool.path ||
            presented.startsWith(`${DRIVES_DIR}/`)
        )
            return byPath(presented)
    }
    let best: F | null = null
    for (const file of files)
        if (
            mountPathMatchesToolPath(file.path, path) &&
            (!best || file.path.length > best.path.length)
        )
            best = file
    return best
}

/** Resolves tool paths against the ambient conversation drive, without reading any file. */
export function useDriveFileLookup(): (path: string, exact?: boolean) => DriveFileLookup {
    const sessionId = useDriveSessionId()
    const artifactId = useDriveArtifactId()
    const revisionId = useDriveRevisionId()
    const {files, homeSlug, homeAtRoot, resolveMount} = useSessionDrive(
        sessionId ?? "",
        artifactId ?? undefined,
        false,
        revisionId ?? undefined,
    )
    // A drive that is the home drive alone presents it at the root, not under `agent-files/`.
    const homePrefix = homeAtRoot ? "" : `${AGENT_FILES_DIR}/`
    return useCallback(
        (path: string, exact = false) => {
            const entry = findDriveEntry(files, path, exact, homeSlug ?? null, homePrefix)
            // The file may live in the cwd mount, the home drive or another drive.
            return {entry, target: entry ? resolveMount(entry.path) : null}
        },
        [files, homeSlug, homePrefix, resolveMount],
    )
}
