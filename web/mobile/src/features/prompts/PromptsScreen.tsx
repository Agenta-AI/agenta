import {useCallback, useMemo, useState} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {TrayIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useDeveloperPageFrame} from "../developer/developerPageFrame"
import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {playgroundHref} from "../playground/playgroundUrl"

import type {PromptsDialog} from "./promptDialogState"
import type {PromptRowActions} from "./promptRowActions"
import {promptsCopy} from "./promptsCopy"
import {PromptsCreateMenu} from "./PromptsCreateMenu"
import {PromptsDialogs} from "./PromptsDialogs"
import {PromptsView} from "./PromptsView"
import {PromptTemplatesPrefetch, useCreatePrompt} from "./useCreatePrompt"
import {usePromptFolderActions} from "./usePromptFolderActions"
import {usePromptsBrowser} from "./usePromptsBrowser"

const CreatePromptDialog = dynamic(
    () => import("./CreatePromptDialog").then((module) => module.CreatePromptDialog),
    {ssr: false},
)

/** The page column, shared with the other lists, so the nav entries line up. */
/**
 * The Prompts page: folders and prompts in one list, with a breadcrumb for the open folder, a
 * search box and the folder writes. A prompt row opens the prompt in the playground while that
 * view is on.
 */
export const PromptsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const PAGE_FRAME = useDeveloperPageFrame()
    useBindProjectContext(projectId)
    const browser = usePromptsBrowser()
    const actions = usePromptFolderActions({
        folderId: browser.folderId,
        foldersById: browser.foldersById,
        openFolder: browser.openFolder,
    })
    const [dialog, setDialog] = useState<PromptsDialog | null>(null)
    const closeDialog = useCallback(() => setDialog(null), [])
    const {openFolder} = browser
    const router = useRouter()
    const playgroundEnabled = useDeveloperViewEnabled("playground") === true
    // Beta developer mode reaches Archived apps from here; its rail has no row for it.
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    const overviewEnabled = useDeveloperViewEnabled("app-overview") === true

    const overviewHref = useCallback(
        (appId: string) =>
            `/w/${workspaceId}/p/${projectId}/apps/${encodeURIComponent(appId)}/overview`,
        [projectId, workspaceId],
    )
    const projectBase = `/w/${workspaceId}/p/${projectId}`
    const createPrompt = useCreatePrompt({projectBase})
    // A new prompt opens in the playground, so New prompt needs it: developer mode only.
    const newPrompt = playgroundEnabled && actions.canEditPrompts ? createPrompt.action : null

    const rowActions = useMemo<PromptRowActions>(
        () => ({
            openFolder: (row) => openFolder(row.folder.id),
            // A row click goes to the playground, or to the overview while the playground is off.
            openPrompt: playgroundEnabled
                ? (row) =>
                      void router.push(
                          playgroundHref(`/w/${workspaceId}/p/${projectId}`, row.prompt.id),
                      )
                : overviewEnabled
                  ? (row) => void router.push(overviewHref(row.prompt.id))
                  : null,
            openOverview: overviewEnabled
                ? (row) => void router.push(overviewHref(row.prompt.id))
                : null,
            rename: (row) =>
                setDialog(
                    row.kind === "folder"
                        ? {kind: "renameFolder", folder: row.folder}
                        : {kind: "renamePrompt", prompt: row.prompt},
                ),
            move: (row) =>
                setDialog(
                    row.kind === "folder"
                        ? {kind: "moveFolder", folder: row.folder}
                        : {kind: "movePrompt", prompt: row.prompt},
                ),
            remove: (row) =>
                setDialog(
                    row.kind === "folder"
                        ? {kind: "deleteFolder", folder: row.folder}
                        : {kind: "archivePrompt", prompt: row.prompt},
                ),
        }),
        [
            openFolder,
            overviewEnabled,
            overviewHref,
            playgroundEnabled,
            projectId,
            router,
            workspaceId,
        ],
    )

    return (
        <>
            <PageTitle title={promptsCopy.pageTitle} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    {promptsCopy.pageTitle}
                                </h1>
                                <PromptsCreateMenu
                                    canEditFolders={actions.canEditFolders}
                                    onNewFolder={() => setDialog({kind: "newFolder"})}
                                    newPrompt={newPrompt}
                                />
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <PromptsView
                            chain={browser.chain}
                            siblingsOf={browser.siblingsOf}
                            rows={browser.rows}
                            search={browser.search}
                            onSearchChange={browser.setSearch}
                            isPending={browser.isPending}
                            isError={browser.isError}
                            emptyKind={browser.emptyKind}
                            canEditFolders={actions.canEditFolders}
                            canEditPrompts={actions.canEditPrompts}
                            rowActions={rowActions}
                            onOpenFolder={browser.openFolder}
                            openDialog={setDialog}
                            newPrompt={newPrompt}
                            onRetry={browser.refetch}
                            toolbarActions={
                                developerMode ? (
                                    <Button asChild size="sm" variant="ghost">
                                        <Link
                                            href={`/w/${workspaceId}/p/${projectId}/apps/archived`}
                                            prefetch={false}
                                        >
                                            <TrayIcon aria-hidden />
                                            {promptsCopy.archived}
                                        </Link>
                                    </Button>
                                ) : undefined
                            }
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            <PromptsDialogs
                dialog={dialog}
                projectId={projectId}
                folderId={browser.folderId}
                foldersById={browser.foldersById}
                actions={actions}
                onClose={closeDialog}
            />
            {newPrompt ? <PromptTemplatesPrefetch /> : null}
            {createPrompt.draftId ? (
                <CreatePromptDialog
                    draftId={createPrompt.draftId}
                    onClose={createPrompt.close}
                    onCreated={createPrompt.land}
                />
            ) : null}
        </>
    )
}
