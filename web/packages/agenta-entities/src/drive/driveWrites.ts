/**
 * Drive WRITES — the transport behind the Files pane's create / save / rename / duplicate /
 * delete. Folder creation and deletion go through the Fern mounts client; a text save reuses the
 * upload endpoint ({@link uploadMountFile} → `write_file`, which overwrites), and the file-only
 * rename / duplicate compose bytes-out → upload → delete because the backend has no move
 * endpoint (folders are therefore not renameable from here).
 *
 * Every write ends with {@link refreshMountListing} so the open directory, the recents summary
 * and the file bodies refetch through the host's query client.
 */
import {getMountsClient} from "@agenta/sdk/resources"
import {type QueryClient} from "@tanstack/react-query"

import {type Mount, projectScopedRequest} from "@agenta/entities/session"

import {fetchMountFileBlob, uploadMountFile} from "./driveMedia"
import {parentOf} from "./driveTreeView"

/** Prefix-match every mount file-query root for the project (dir listing, root, latest, summary,
 * bodies) — the one refresh every drive write (upload, save, delete, …) ends with. */
export const refreshMountListing = (queryClient: QueryClient, projectId: string): void => {
    for (const root of ["files", "files-latest", "files-root", "files-dir", "file"]) {
        void queryClient.invalidateQueries({queryKey: ["mounts", root, projectId]})
    }
}

const errorMessage = (error: unknown, fallback: string): string => {
    if (error && typeof error === "object") {
        const body = (error as {body?: {detail?: unknown}}).body
        if (body && typeof body.detail === "string") return body.detail
        if (error instanceof Error && error.message) return error.message
    }
    return fallback
}

const rethrow = (error: unknown, fallback: string): never => {
    throw new Error(errorMessage(error, fallback))
}

export interface DriveWriteTarget {
    mount: Mount
    /** Mount-relative path. */
    path: string
    projectId: string
}

export async function createMountFolder({mount, path, projectId}: DriveWriteTarget) {
    try {
        await getMountsClient().createMountFolder(
            {mount_id: mount.id, path},
            projectScopedRequest(projectId),
        )
    } catch (error) {
        rethrow(error, "Couldn't create the folder")
    }
}

export async function deleteMountPath({mount, path, projectId}: DriveWriteTarget) {
    try {
        await getMountsClient().deleteMountFile(
            {mount_id: mount.id, path},
            projectScopedRequest(projectId),
        )
    } catch (error) {
        rethrow(error, "Couldn't delete")
    }
}

/** Write text to a path (a new file or an overwrite). */
export async function saveMountText({
    mount,
    path,
    projectId,
    text,
}: DriveWriteTarget & {text: string}) {
    const name = path.split("/").pop() ?? path
    try {
        await uploadMountFile({
            mountId: mount.id,
            destFolder: parentOf(path),
            destName: name,
            file: new File([text], name, {type: "text/plain"}),
            projectId,
        })
    } catch (error) {
        rethrow(error, "Couldn't save the file")
    }
}

/** Copy one FILE's bytes to a new mount-relative path; `removeSource` turns it into a move. */
export async function copyMountFile({
    mount,
    path,
    projectId,
    toPath,
    removeSource,
}: DriveWriteTarget & {toPath: string; removeSource: boolean}) {
    const blob = await fetchMountFileBlob({mountId: mount.id, projectId, path})
    if (!blob) throw new Error("Couldn't read the file")
    const name = toPath.split("/").pop() ?? toPath
    try {
        await uploadMountFile({
            mountId: mount.id,
            destFolder: parentOf(toPath),
            destName: name,
            file: new File([blob], name, {type: blob.type}),
            projectId,
        })
    } catch (error) {
        rethrow(error, "Couldn't write the file")
    }
    if (removeSource) await deleteMountPath({mount, path, projectId})
}
