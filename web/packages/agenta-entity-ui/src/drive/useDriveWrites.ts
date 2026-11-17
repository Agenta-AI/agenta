/** The Files pane's write verbs bound to one drive: resolve the mount, run, refresh; a failure toasts. */
import {useCallback, useMemo, useRef, useState} from "react"

import {
    AGENT_FILES_DIR,
    DRIVES_DIR,
    fileOrigin,
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
import driveBrowserCatalog from "@agenta/i18n/catalogs/entityUi.driveBrowser"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
import {projectIdAtom} from "@agenta/shared/state"
import {message, modal} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

/** Mount roots (the root, `agent-files/`, `drives/<slug>/`), the `drives/` folder that holds them
 * and read drives are never renamed or deleted. */
export const canMoveOrDelete = (
    drive: Pick<SessionDriveData, "resolveMount" | "otherDrives">,
    presentedPath: string,
): boolean => {
    if (["", AGENT_FILES_DIR, DRIVES_DIR].includes(presentedPath)) return false
    if (fileOrigin(presentedPath, drive.otherDrives) !== "drive") return true
    const resolved = drive.resolveMount(presentedPath)
    return Boolean(resolved && resolved.path !== "" && !resolved.readOnly)
}

// Toasts and the confirm open from callbacks, outside render.
const tNow = createT(driveExplorerCatalog, driveBrowserCatalog)

export function useDriveWrites(
    drive: SessionDriveData,
    /** The delete confirm stays inside this element (the pane) rather than covering the window. */
    getContainer?: () => HTMLElement | null,
) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useAtomValue(queryClientAtom)
    const [busy, setBusy] = useState(false)
    // A delete confirmed later writes through the drive as it is then (a drive set to read).
    const driveRef = useRef(drive)
    driveRef.current = drive

    const run = useCallback(
        async (
            presentedPath: string,
            fn: (target: {
                mount: NonNullable<SessionDriveData["mount"]>
                path: string
            }) => Promise<void>,
            success?: string,
        ): Promise<boolean> => {
            const resolved = driveRef.current.resolveMount(presentedPath)
            if (!resolved?.mount || resolved.readOnly) {
                void message.error(tNow("entityUi.driveBrowser.cannotWriteHere"))
                return false
            }
            setBusy(true)
            try {
                await fn({mount: resolved.mount, path: resolved.path})
                refreshMountListing(queryClient, projectId)
                if (success) void message.success(success)
                return true
            } catch (error) {
                void message.error(
                    error instanceof Error
                        ? error.message
                        : tNow("entityUi.driveBrowser.somethingWentWrong"),
                )
                return false
            } finally {
                setBusy(false)
            }
        },
        [projectId, queryClient],
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
                        ? tNow("entityUi.driveBrowser.deleteFolder")
                        : tNow("entityUi.driveBrowser.deleteFile"),
                    content: isFolder
                        ? itemCount
                            ? tNow("entityUi.driveBrowser.deleteFolderItems", {
                                  name,
                                  count: itemCount,
                              })
                            : tNow("entityUi.driveBrowser.deleteFolderAll", {name})
                        : tNow("entityUi.driveBrowser.deleteFileConfirm", {name}),
                    okText: tNow("entityUi.driveExplorer.delete"),
                    okButtonProps: {danger: true},
                    onOk: async () => {
                        resolve(
                            await run(
                                presentedPath,
                                ({mount, path}) => deleteMountPath({mount, path, projectId}),
                                tNow("entityUi.driveBrowser.deletedName", {name}),
                            ),
                        )
                    },
                    onCancel: () => resolve(false),
                })
            }),
        [run, projectId, getContainer],
    )

    const canChange = useCallback(
        (presentedPath: string) => canMoveOrDelete(drive, presentedPath),
        [drive],
    )

    return useMemo(
        () => ({
            busy,
            createFolder,
            createFile,
            rename,
            renameEmptyFolder,
            remove,
            canChange,
        }),
        [busy, createFolder, createFile, rename, renameEmptyFolder, remove, canChange],
    )
}
