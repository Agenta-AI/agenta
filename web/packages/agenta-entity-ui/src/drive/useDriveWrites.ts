/** The Files pane's write verbs bound to one drive: resolve the mount, run, refresh, toast. */
import {useCallback, useMemo, useState} from "react"

import {
    AGENT_FILES_DIR,
    copyMountFile,
    createMountFolder,
    deleteMountPath,
    itemCountLabel,
    joinPath,
    nameOf,
    parentOf,
    refreshMountListing,
    saveMountText,
    type SessionDriveData,
} from "@agenta/entities/drive"
import {projectIdAtom} from "@agenta/shared/state"
import {message, modal} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

export function useDriveWrites(drive: SessionDriveData) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useAtomValue(queryClientAtom)
    const [busy, setBusy] = useState(false)

    const run = useCallback(
        async (
            presentedPath: string,
            fn: (target: {
                mount: NonNullable<SessionDriveData["mount"]>
                path: string
            }) => Promise<void>,
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
    // Rename / duplicate: a copy into the same folder, with or without the source removed.
    const copyAs = useCallback(
        (presentedPath: string, newName: string, removeSource: boolean, success: string) => {
            const sibling = joinPath(parentOf(presentedPath), newName)
            const toPath = drive.resolveMount(sibling)?.path ?? sibling
            return run(
                presentedPath,
                ({mount, path}) => copyMountFile({mount, path, projectId, toPath, removeSource}),
                success,
            )
        },
        [drive, run, projectId],
    )
    const rename = useCallback(
        (presentedPath: string, newName: string) =>
            copyAs(presentedPath, newName, true, `Renamed to ${newName}`),
        [copyAs],
    )
    const duplicate = useCallback(
        (presentedPath: string, newName: string) =>
            copyAs(presentedPath, newName, false, `Duplicated as ${newName}`),
        [copyAs],
    )
    const remove = useCallback(
        (presentedPath: string, isFolder: boolean, itemCount?: number | null) =>
            new Promise<boolean>((resolve) => {
                const name = nameOf(presentedPath)
                modal.confirm({
                    centered: true,
                    title: isFolder ? "Delete folder" : "Delete file",
                    content: isFolder
                        ? `"${name}"${itemCount ? ` and its ${itemCountLabel(itemCount)}` : " and everything in it"} will be permanently deleted.`
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

    /** Mount roots (the root, `agent-files/`) never offer Delete. */
    const canDelete = useCallback(
        (presentedPath: string) => presentedPath !== "" && presentedPath !== AGENT_FILES_DIR,
        [],
    )

    return useMemo(
        () => ({busy, createFolder, createFile, rename, duplicate, remove, canDelete}),
        [busy, createFolder, createFile, rename, duplicate, remove, canDelete],
    )
}
