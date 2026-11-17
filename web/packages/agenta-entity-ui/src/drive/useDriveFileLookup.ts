import {useCallback} from "react"

import {useSessionDrive, type ResolvedMountPath} from "@agenta/entities/drive"
import {mountPathMatchesToolPath, type MountFile} from "@agenta/entities/session"

import {useDriveArtifactId, useDriveRevisionId, useDriveSessionId} from "./driveSessionContext"

export interface DriveFileLookup {
    /** The listing's entry for a tool path; null when the listing does not have it (yet). */
    entry: MountFile | null
    /** The mount and mount-relative path that read or download it. */
    target: ResolvedMountPath | null
}

/**
 * The listing's entry for a path. `exact` takes a drive path as is; a tool path matches on its
 * tail, and the longest matching path wins, so `drives/prices/a.md` never resolves to a shorter
 * `a.md` that only shares its tail.
 */
export const findDriveEntry = <F extends {path: string}>(
    files: readonly F[],
    path: string,
    exact = false,
): F | null => {
    if (exact) return files.find((file) => file.path === path) ?? null
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
    const {files, resolveMount} = useSessionDrive(
        sessionId ?? "",
        artifactId ?? undefined,
        false,
        revisionId ?? undefined,
    )
    return useCallback(
        (path: string, exact = false) => {
            const entry = findDriveEntry(files, path, exact)
            // The file may live in the cwd mount, the home drive or another drive.
            return {entry, target: entry ? resolveMount(entry.path) : null}
        },
        [files, resolveMount],
    )
}
