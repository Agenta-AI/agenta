import {useCallback, useRef, useState} from "react"

import {
    archiveWorkflow,
    createFolder,
    deleteFolder,
    folderChain,
    folderSlug,
    invalidateProjectFolders,
    isValidMoveTarget,
    moveFolder,
    moveWorkflowToFolder,
    renameFolder,
    renameWorkflow,
    type Folder,
    type FoldersById,
} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"

import {folderErrorSentence} from "./promptFolderError"
import {promptsCopy} from "./promptsCopy"

/** What a write answers: done, or the sentence a dialog shows while it stays open. */
export type ActionResult = {ok: true} | {ok: false; error: string}

const DONE: ActionResult = {ok: true}
const fail = (error: string): ActionResult => ({ok: false, error})

interface PromptRef {
    id: string
    folder_id?: string | null
}

/**
 * Every folder and prompt write of the Prompts page. Each one checks the permission, refuses a
 * second call while one runs, refetches what it changed and shows the toast. A failure comes
 * back as a plain sentence for the dialog, never as the raw error.
 */
export const usePromptFolderActions = ({
    folderId,
    foldersById,
    openFolder,
}: {
    /** The open folder: a create lands inside it. */
    folderId: string | null
    foldersById: FoldersById
    openFolder: (id: string | null) => void
}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()
    const canEditFolders = useProjectPermission(projectId, "edit_folders")
    const canEditPrompts = useProjectPermission(projectId, "edit_workflows")
    const running = useRef(false)
    const [pending, setPending] = useState(false)

    const refetchFolders = useCallback(() => invalidateProjectFolders(queryClient), [queryClient])
    const refetchPrompts = useCallback(
        () => queryClient.invalidateQueries({queryKey: ["workflows"]}),
        [queryClient],
    )

    const run = useCallback(
        async (
            allowed: boolean,
            work: () => Promise<ActionResult | void>,
            failure: string,
            readError: (error: unknown) => string | null = () => null,
        ): Promise<ActionResult> => {
            if (!allowed || running.current) return fail(failure)
            running.current = true
            setPending(true)
            try {
                return (await work()) ?? DONE
            } catch (error) {
                return fail(readError(error) ?? failure)
            } finally {
                running.current = false
                setPending(false)
            }
        },
        [],
    )

    const folderWrite = useCallback(
        (work: () => Promise<ActionResult | void>, failure: string) =>
            run(canEditFolders, work, failure, folderErrorSentence),
        [canEditFolders, run],
    )

    const moveGuard = useCallback(
        (folder: Folder, destinationId: string | null): string | null => {
            if (!destinationId) return promptsCopy.guard.noDestination
            if (!foldersById.has(destinationId) || !foldersById.has(folder.id)) {
                return promptsCopy.guard.notFound
            }
            if (
                isValidMoveTarget({
                    foldersById,
                    item: {kind: "folder", id: folder.id},
                    destinationId,
                })
            ) {
                return null
            }
            const intoItself = folderChain(foldersById, destinationId).some(
                (ancestor) => ancestor.id === folder.id,
            )
            return intoItself ? promptsCopy.guard.intoItself : promptsCopy.guard.sameParent
        },
        [foldersById],
    )

    return {
        canEditFolders,
        canEditPrompts,
        pending,

        createFolder: (name: string) =>
            folderWrite(async () => {
                const trimmed = name.trim()
                await createFolder({
                    projectId,
                    name: trimmed,
                    slug: folderSlug(trimmed),
                    parentId: folderId,
                })
                await refetchFolders()
                message.success(promptsCopy.toast.folderCreated)
            }, promptsCopy.failure.saveFolder),

        renameFolder: (folder: Folder, name: string) =>
            folderWrite(async () => {
                const trimmed = name.trim()
                await renameFolder({
                    projectId,
                    folderId: folder.id,
                    name: trimmed,
                    slug: folderSlug(trimmed),
                })
                await refetchFolders()
                message.success(promptsCopy.toast.folderRenamed)
            }, promptsCopy.failure.saveFolder),

        moveFolder: (folder: Folder, destinationId: string | null) =>
            folderWrite(async () => {
                const blocked = moveGuard(folder, destinationId)
                if (blocked || !destinationId)
                    return fail(blocked ?? promptsCopy.guard.noDestination)
                await moveFolder({projectId, folder, destinationId})
                await refetchFolders()
                message.success(promptsCopy.toast.folderMoved)
            }, promptsCopy.failure.moveFolder),

        deleteFolder: (folder: Folder) =>
            folderWrite(async () => {
                await deleteFolder({projectId, folderId: folder.id})
                // The server deletes the subfolders too, and keeps their prompts.
                const openIsGone = folderChain(foldersById, folderId).some(
                    (ancestor) => ancestor.id === folder.id,
                )
                await Promise.all([refetchFolders(), refetchPrompts()])
                if (openIsGone) openFolder(folder.parent_id ?? null)
                message.success(promptsCopy.toast.folderDeleted)
            }, promptsCopy.failure.deleteFolder),

        movePrompt: (prompt: PromptRef, destinationId: string | null) =>
            run(
                canEditPrompts,
                async () => {
                    if (!destinationId) return fail(promptsCopy.guard.noDestination)
                    if (
                        !isValidMoveTarget({
                            foldersById,
                            item: {
                                kind: "prompt",
                                id: prompt.id,
                                folderId: prompt.folder_id ?? null,
                            },
                            destinationId,
                        })
                    ) {
                        return fail(promptsCopy.guard.sameParent)
                    }
                    await moveWorkflowToFolder({
                        projectId,
                        workflowId: prompt.id,
                        folderId: destinationId,
                    })
                    await refetchPrompts()
                    message.success(promptsCopy.toast.appMoved)
                },
                promptsCopy.failure.movePrompt,
            ),

        renamePrompt: (prompt: {id: string}, fields: {name: string; description: string}) =>
            run(
                canEditPrompts,
                async () => {
                    await renameWorkflow({projectId, workflowId: prompt.id, ...fields})
                    await refetchPrompts()
                },
                promptsCopy.failure.renamePrompt,
            ),

        archivePrompt: (prompt: PromptRef) =>
            run(
                canEditPrompts,
                async () => {
                    await archiveWorkflow(projectId, prompt.id)
                    await refetchPrompts()
                    message.success(promptsCopy.toast.appArchived)
                },
                promptsCopy.failure.archivePrompt,
            ),
    }
}
