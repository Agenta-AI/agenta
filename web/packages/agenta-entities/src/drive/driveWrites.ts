/**
 * The transport behind the Files pane's writes. Create / delete use the Fern mounts client; a
 * text save is an upload (`write_file` overwrites); rename / duplicate are read → upload → delete
 * because the backend has no move endpoint (so folders can't be renamed here).
 */
import {getMountsClient} from "@agenta/sdk/resources"
import {type QueryClient} from "@tanstack/react-query"

import {type Mount, projectScopedRequest} from "@agenta/entities/session"

import {fetchMountFileBlob, uploadMountFile} from "./driveMedia"
import {nameOf, parentOf} from "./driveTreeView"

/** Invalidate the project's mount listings (and, unless `contents` is off, the file bodies).
 * Resolves once the open listings have refetched. */
export const refreshMountListing = (
    queryClient: QueryClient,
    projectId: string,
    {contents = true}: {contents?: boolean} = {},
): Promise<void> => {
    const roots = ["files", "files-latest", "files-root", "files-dir"]
    if (contents) roots.push("file")
    return Promise.all(
        roots.map((root) => queryClient.invalidateQueries({queryKey: ["mounts", root, projectId]})),
    ).then(() => undefined)
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

interface DriveWriteTarget {
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
    const name = nameOf(path)
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
    const name = nameOf(toPath)
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
