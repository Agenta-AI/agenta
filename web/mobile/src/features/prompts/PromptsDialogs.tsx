import {useCallback, useEffect, useState} from "react"

import {
    folderPathPreview,
    isValidMoveTarget,
    type Folder,
    type FoldersById,
    type MoveItem,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {FolderIcon} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"

import {RenameAppDialog} from "../app-overview/RenameAppDialog"

import {FolderNameDialog} from "./dialogs/FolderNameDialog"
import {MoveToFolderDialog} from "./dialogs/MoveToFolderDialog"
import type {PromptsDialog} from "./promptDialogState"
import {promptsCopy} from "./promptsCopy"
import type {ActionResult, usePromptFolderActions} from "./usePromptFolderActions"

type Actions = ReturnType<typeof usePromptFolderActions>

/** What the move dialog is moving, and the folder the item sits in now. */
const moveTarget = (
    dialog: PromptsDialog | null,
): {name: string; currentId: string | null; item: MoveItem} | null => {
    if (dialog?.kind === "moveFolder") {
        return {
            name: dialog.folder.name ?? "",
            currentId: dialog.folder.id,
            item: {kind: "folder", id: dialog.folder.id},
        }
    }
    if (dialog?.kind === "movePrompt") {
        const folderId = dialog.prompt.folder_id ?? null
        return {
            name: dialog.prompt.name ?? "",
            currentId: folderId,
            item: {kind: "prompt", id: dialog.prompt.id, folderId},
        }
    }
    return null
}

/**
 * Hosts the dialog the page has open: runs its write, shows the failure sentence inside it
 * and closes it when the write is done.
 */
export const PromptsDialogs = ({
    dialog,
    projectId,
    folderId,
    foldersById,
    actions,
    onClose,
}: {
    dialog: PromptsDialog | null
    projectId: string
    folderId: string | null
    foldersById: FoldersById
    actions: Actions
    onClose: () => void
}) => {
    const t = useT(commonCatalog)
    const queryClient = useQueryClient()
    const [error, setError] = useState<string | null>(null)
    // A new dialog starts without the last one's failure.
    useEffect(() => setError(null), [dialog])

    const finish = useCallback(
        async (work: Promise<ActionResult>) => {
            const result = await work
            if (result.ok) onClose()
            else setError(result.error)
        },
        [onClose],
    )

    const folders: Folder[] = [...foldersById.values()]
    const move = moveTarget(dialog)
    const common = {pending: actions.pending, error, onClose}
    const closeUnlessPending = (next: boolean) => {
        if (!next && !actions.pending) onClose()
    }

    return (
        <>
            <FolderNameDialog
                {...common}
                open={dialog?.kind === "newFolder" || dialog?.kind === "renameFolder"}
                mode={dialog?.kind === "renameFolder" ? "rename" : "create"}
                initialName={dialog?.kind === "renameFolder" ? (dialog.folder.name ?? "") : ""}
                pathFor={(name) =>
                    folderPathPreview(
                        foldersById,
                        dialog?.kind === "renameFolder"
                            ? (dialog.folder.parent_id ?? null)
                            : folderId,
                        name,
                    )
                }
                onSubmit={(name) => {
                    if (dialog?.kind === "renameFolder") {
                        void finish(actions.renameFolder(dialog.folder, name))
                    } else void finish(actions.createFolder(name))
                }}
            />
            <MoveToFolderDialog
                {...common}
                open={move !== null}
                itemName={move?.name ?? ""}
                folders={folders}
                initialSelectedId={move?.currentId ?? null}
                isDisabled={(destinationId) =>
                    move ? !isValidMoveTarget({foldersById, item: move.item, destinationId}) : true
                }
                onConfirm={(destinationId) => {
                    if (dialog?.kind === "moveFolder") {
                        void finish(actions.moveFolder(dialog.folder, destinationId))
                    } else if (dialog?.kind === "movePrompt") {
                        void finish(actions.movePrompt(dialog.prompt, destinationId))
                    }
                }}
            />
            <AlertDialog open={dialog?.kind === "deleteFolder"} onOpenChange={closeUnlessPending}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{promptsCopy.deleteDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {promptsCopy.deleteDialog.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-col gap-2 text-body">
                        <span>{promptsCopy.deleteDialog.about}</span>
                        <span className="flex min-w-0 items-center gap-2 font-medium">
                            <FolderIcon className="size-4 shrink-0" />
                            <span className="truncate">
                                {(dialog?.kind === "deleteFolder" ? dialog.folder.name : null) ||
                                    promptsCopy.deleteDialog.fallbackName}
                            </span>
                        </span>
                    </div>
                    {error ? <p className="m-0 text-body text-destructive">{error}</p> : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline" onClick={onClose} disabled={actions.pending}>
                                {t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={actions.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    if (dialog?.kind === "deleteFolder")
                                        void finish(actions.deleteFolder(dialog.folder))
                                }}
                            >
                                {actions.pending
                                    ? t("common.working")
                                    : promptsCopy.deleteDialog.confirm}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog open={dialog?.kind === "archivePrompt"} onOpenChange={closeUnlessPending}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{promptsCopy.archiveDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {promptsCopy.archiveDialog.text(
                                dialog?.kind === "archivePrompt" ? (dialog.prompt.name ?? "") : "",
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error ? <p className="m-0 text-body text-destructive">{error}</p> : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline" onClick={onClose} disabled={actions.pending}>
                                {t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={actions.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    if (dialog?.kind === "archivePrompt") {
                                        void finish(actions.archivePrompt(dialog.prompt))
                                    }
                                }}
                            >
                                {actions.pending
                                    ? t("common.working")
                                    : promptsCopy.archiveDialog.confirm}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {dialog?.kind === "renamePrompt" ? (
                // The one rename dialog: the app overview uses it too. It blocks a name another
                // app already has, and it closes itself when the save is done.
                <RenameAppDialog
                    key={dialog.prompt.id}
                    projectId={projectId}
                    app={dialog.prompt}
                    onClose={() => {
                        void queryClient.invalidateQueries({queryKey: ["workflows"]})
                        onClose()
                    }}
                />
            ) : null}
        </>
    )
}
