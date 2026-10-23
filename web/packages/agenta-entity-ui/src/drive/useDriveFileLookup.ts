import {useCallback} from "react"

import {useSessionDrive, type ResolvedMountPath} from "@agenta/entities/drive"
import {mountPathMatchesToolPath, type MountFile} from "@agenta/entities/session"

import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"

export interface DriveFileLookup {
    /** The listing's entry for a tool path; null when the listing does not have it (yet). */
    entry: MountFile | null
    /** The mount and mount-relative path that read or download it. */
    target: ResolvedMountPath | null
}

/** Resolves tool paths against the ambient conversation drive, without reading any file. */
export function useDriveFileLookup(): (path: string) => DriveFileLookup {
    const sessionId = useDriveSessionId()
    const artifactId = useDriveArtifactId()
    const {files, resolveMount} = useSessionDrive(sessionId ?? "", artifactId ?? undefined)
    return useCallback(
        (path: string) => {
            const entry = files.find((file) => mountPathMatchesToolPath(file.path, path)) ?? null
            // The file may live in the cwd mount or the nested agent-files mount.
            return {entry, target: entry ? resolveMount(entry.path) : null}
        },
        [files, resolveMount],
    )
}
