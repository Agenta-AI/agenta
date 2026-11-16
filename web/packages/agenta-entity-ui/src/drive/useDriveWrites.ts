/** The Files pane's write verbs bound to one drive: resolve the mount, run, refresh; a failure toasts. */
import {useCallback, useMemo, useState} from "react"

import {
    AGENT_FILES_DIR,
    moveMountFile,
    createMountFolder,
    deleteMountPath,
    joinPath,
    nameOf,
    parentOf,
    refreshMountListing,
    saveMountText,
    type SessionDriveData,
} from "@agenta/entities/drive"
import {createT} from "@agenta/i18n"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
import {projectIdAtom} from "@agenta/shared/state"
import {message, modal} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

// Toasts and the confirm open from callbacks, outside render.
const tNow = createT(driveExplorerCatalog)

export function useDriveWrites(
    drive: SessionDriveData,
    /** The delete confirm stays inside this element (the pane) rather than covering the window. */
    getContainer?: () => HTMLElement | null,
) {
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
            success?: string,
        ): Promise<boolean> => {
            const resolved = drive.resolveMount(presentedPath)
            if (!resolved?.mount) {
                void message.error(tNow("entityUi.driveExplorer.cannotWriteHere"))
                return false
            }
            setBusy(true)
            try {
                await fn({mount: resolved.mount, path: resolved.path})
                refreshMountListing(queryClient, projectId)
                if (success) void message.success(success)
                return true
            } catch (error) {
                void message.error(error instanceof Error
                        ? error.message
                        : tNow("entityUi.driveExplorer.somethingWentWrong"),)
                return false
            } finally {
                setBusy(false)
            }
        },
        [drive, projectId, queryClient],
    )

    const createFolder = useCallback(
        (folder: string, name: string) =>
            run(joinPath(folder, name), ({mount, path}) =>
                createMountFolder({mount, path, projectId}),
            ),
        [run, projectId],
    )
    const createFile = useCallback(
        (folder: string, name: string) =>
            run(joinPath(folder, name), ({mount, path}) =>
                saveMountText({mount, path, projectId, text: ""}),
            ),
        [run, projectId],
    )
    const rename = useCallback(
        (presentedPath: string, newName: string) => {
            const sibling = joinPath(parentOf(presentedPath), newName)
            const toPath = drive.resolveMount(sibling)?.path ?? sibling
            return run(presentedPath, ({mount, path}) =>
                moveMountFile({mount, path, projectId, toPath}),
            )
        },
        [drive, run, projectId],
    )
    // A just-created (empty) folder is renamed by creating the new one and dropping the old.
    const renameEmptyFolder = useCallback(
        (presentedPath: string, newName: string) => {
            const folder = parentOf(presentedPath)
            return run(joinPath(folder, newName), async ({mount, path}) => {
                await createMountFolder({mount, path, projectId})
                const old = drive.resolveMount(presentedPath)
                if (old?.mount) await deleteMountPath({mount: old.mount, path: old.path, projectId})
            })
        },
        [drive, run, projectId],
    )
    const remove = useCallback(
        (presentedPath: string, isFolder: boolean, itemCount?: number | null) =>
            new Promise<boolean>((resolve) => {
                const name = nameOf(presentedPath)
                modal.confirm({
                    centered: true,
                    getContainer,
                    title: isFolder
                        ? tNow("entityUi.driveExplorer.deleteFolder")
                        : tNow("entityUi.driveExplorer.deleteFile"),
                    content: isFolder
                        ? itemCount
                            ? tNow("entityUi.driveExplorer.deleteFolderItems", {
                                  name,
                                  count: itemCount,
                              })
                            : tNow("entityUi.driveExplorer.deleteFolderAll", {name})
                        : tNow("entityUi.driveExplorer.deleteFileConfirm", {name}),
                    okText: tNow("entityUi.driveExplorer.delete"),
                    okButtonProps: {danger: true},
                    onOk: async () => {
                        resolve(
                            await run(
                                presentedPath,
                                ({mount, path}) => deleteMountPath({mount, path, projectId}),
                                tNow("entityUi.driveExplorer.deletedName", {name}),
                            ),
                        )
                    },
                    onCancel: () => resolve(false),
                })
            }),
        [run, projectId, getContainer],
    )

    /** Mount roots (the root, `agent-files/`) never offer Delete. */
    const canDelete = useCallback(
        (presentedPath: string) => presentedPath !== "" && presentedPath !== AGENT_FILES_DIR,
        [],
    )

    return useMemo(
        () => ({
            busy,
            createFolder,
            createFile,
            rename,
            renameEmptyFolder,
            remove,
            canDelete,
        }),
        [busy, createFolder, createFile, rename, renameEmptyFolder, remove, canDelete],
    )
}
