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
            // `exact` takes a drive path as is; a tool path matches on its tail.
            const entry =
                files.find((file) =>
                    exact ? file.path === path : mountPathMatchesToolPath(file.path, path),
                ) ?? null
            // The file may live in the cwd mount, the agent-files mount or a project drive.
            return {entry, target: entry ? resolveMount(entry.path) : null}
        },
        [files, resolveMount],
    )
}
