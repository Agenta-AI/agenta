/**
 * useDriveWrites — the Files pane's write verbs bound to one drive: create folder / file, rename,
 * duplicate, delete. Resolves the presented path to its mount (cwd or the folded
 * `agent-files/` mount), calls the transport in `@agenta/entities/drive`, refreshes the listing
 * and reports through the kit's message service. The name / path prompts are the caller's
 * ({@link DriveNameDialog}); delete confirms here through `modal.confirm`.
 */
import {useCallback, useMemo, useState} from "react"

import {
    AGENT_FILES_DIR,
    copyMountFile,
    createMountFolder,
    deleteMountPath,
    refreshMountListing,
    saveMountText,
    type SessionDriveData,
} from "@agenta/entities/drive"
import {projectIdAtom} from "@agenta/shared/state"
import {message, modal} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)

export function useDriveWrites(drive: SessionDriveData) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useAtomValue(queryClientAtom)
    const [busy, setBusy] = useState(false)

    // Every verb: resolve the mount, run, refresh, toast — one wrapper so none of them drifts.
    const run = useCallback(
        async (
            presentedPath: string,
            fn: (target: {mount: NonNullable<SessionDriveData["mount"]>; path: string}) => Promise<void>,
            success: string,
        ): Promise<boolean> => {
            const resolved = drive.resolveMount(presentedPath)
            if (!resolved?.mount) {
                void message.error("This location can't be written to")
                return false
            }
            setBusy(true)
            try {
                await fn({mount: resolved.mount, path: resolved.path})
                refreshMountListing(queryClient, projectId)
                void message.success(success)
                return true
            } catch (error) {
                void message.error(error instanceof Error ? error.message : "Something went wrong")
                return false
            } finally {
                setBusy(false)
            }
        },
        [drive, projectId, queryClient],
    )

    const createFolder = useCallback(
        (folder: string, name: string) =>
            run(
                joinPath(folder, name),
                ({mount, path}) => createMountFolder({mount, path, projectId}),
                `Created ${name}`,
            ),
        [run, projectId],
    )
    const createFile = useCallback(
        (folder: string, name: string) =>
            run(
                joinPath(folder, name),
                ({mount, path}) => saveMountText({mount, path, projectId, text: ""}),
                `Created ${name}`,
            ),
        [run, projectId],
    )
    const rename = useCallback(
        (presentedPath: string, newName: string) => {
            const folder = presentedPath.slice(0, Math.max(0, presentedPath.lastIndexOf("/")))
            const target = drive.resolveMount(joinPath(folder, newName))
            return run(
                presentedPath,
                ({mount, path}) =>
                    copyMountFile({
                        mount,
                        path,
                        projectId,
                        toPath: target?.path ?? joinPath(folder, newName),
                        removeSource: true,
                    }),
                `Renamed to ${newName}`,
            )
        },
        [drive, run, projectId],
    )
    const duplicate = useCallback(
        (presentedPath: string, newName: string) => {
            const folder = presentedPath.slice(0, Math.max(0, presentedPath.lastIndexOf("/")))
            const target = drive.resolveMount(joinPath(folder, newName))
            return run(
                presentedPath,
                ({mount, path}) =>
                    copyMountFile({
                        mount,
                        path,
                        projectId,
                        toPath: target?.path ?? joinPath(folder, newName),
                        removeSource: false,
                    }),
                `Duplicated as ${newName}`,
            )
        },
        [drive, run, projectId],
    )
    const remove = useCallback(
        (presentedPath: string, isFolder: boolean, itemCount?: number | null) =>
            new Promise<boolean>((resolve) => {
                const name = nameOf(presentedPath)
                modal.confirm({
                    centered: true,
                    title: isFolder ? "Delete folder" : "Delete file",
                    content: isFolder
                        ? `"${name}"${itemCount ? ` and its ${itemCount} item${itemCount === 1 ? "" : "s"}` : " and everything in it"} will be permanently deleted.`
                        : `"${name}" will be permanently deleted.`,
                    okText: "Delete",
                    okButtonProps: {danger: true},
                    onOk: async () => {
                        resolve(
                            await run(
                                presentedPath,
                                ({mount, path}) => deleteMountPath({mount, path, projectId}),
                                `Deleted ${name}`,
                            ),
                        )
                    },
                    onCancel: () => resolve(false),
                })
            }),
        [run, projectId],
    )

    /** The root and the `agent-files/` fold point are mount roots — deleting one would empty the
     * whole mount, so they never offer Delete. */
    const canDelete = useCallback(
        (presentedPath: string) => presentedPath !== "" && presentedPath !== AGENT_FILES_DIR,
        [],
    )

    return useMemo(
        () => ({busy, createFolder, createFile, rename, duplicate, remove, canDelete}),
        [busy, createFolder, createFile, rename, duplicate, remove, canDelete],
    )
}

export type DriveWrites = ReturnType<typeof useDriveWrites>
