import {
    mountDirQueryKey,
    mountFileContentQueryKey,
    invalidateMountListings,
    queryMountDir,
    writeMountFile,
} from "@agenta/entities/session"
import type {QueryClient} from "@tanstack/react-query"

import {parentOf} from "../driveTreeView"

import {conflictFromListing, type DriveEditConflict} from "./model"

export interface SaveDriveFileInput {
    queryClient: QueryClient
    projectId: string
    targetMountId: string
    targetPath: string
    draft: string
    baseMtime: number | null
    includeGitignored: boolean
    skipConflictCheck: boolean
}

export type SaveDriveFileResult =
    | {kind: "saved"; size: number}
    | ({kind: "conflict"} & DriveEditConflict)
    | {kind: "error"; message: string}

export interface SaveDriveFileDependencies {
    queryDir: typeof queryMountDir
    writeFile: typeof writeMountFile
}

const DEFAULT_DEPENDENCIES: SaveDriveFileDependencies = {
    queryDir: queryMountDir,
    writeFile: writeMountFile,
}

export async function saveDriveFile(
    input: SaveDriveFileInput,
    dependencies: SaveDriveFileDependencies = DEFAULT_DEPENDENCIES,
): Promise<SaveDriveFileResult> {
    const {
        queryClient,
        projectId,
        targetMountId,
        targetPath,
        draft,
        baseMtime,
        includeGitignored,
        skipConflictCheck,
    } = input

    if (!skipConflictCheck) {
        const directory = parentOf(targetPath)
        const listing = await queryClient.fetchQuery({
            queryKey: mountDirQueryKey(projectId, targetMountId, directory, includeGitignored),
            queryFn: ({signal: querySignal}) =>
                dependencies.queryDir({
                    projectId,
                    mountId: targetMountId,
                    path: directory,
                    withCounts: true,
                    includeGitignored,
                    abortSignal: querySignal,
                }),
            staleTime: 0,
        })
        if (!listing) {
            return {kind: "error", message: "Couldn’t verify the file before saving"}
        }
        const conflict = conflictFromListing(listing, targetPath, baseMtime)
        if (conflict) return {kind: "conflict", ...conflict}
    }

    const written = await dependencies.writeFile({
        projectId,
        mountId: targetMountId,
        path: targetPath,
        content: draft,
    })
    if (!written.ok) return {kind: "error", message: written.message}

    queryClient.setQueryData(mountFileContentQueryKey(projectId, targetMountId, targetPath), draft)
    invalidateMountListings(queryClient, projectId)
    return {kind: "saved", size: written.size}
}
