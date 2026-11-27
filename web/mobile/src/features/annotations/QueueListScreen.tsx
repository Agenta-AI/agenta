import {
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerOpenAtom,
    createQueueDrawerSelectionAtom,
} from "@agenta/annotation"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
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
import {PlusIcon} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission} from "../context/useProjectPermission"
import {useDeveloperPageFrame} from "../developer/developerPageFrame"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {QueueListContent} from "./QueueListContent"
import {useQueueDelete} from "./useQueueDelete"
import {useQueueList} from "./useQueueList"

/** The annotation queues of the project: search, type filter, the list and the delete confirm. */
export const QueueListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const t = useT(queueScreensCatalog, commonCatalog)
    const PAGE_FRAME = useDeveloperPageFrame()
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const list = useQueueList()
    const canEdit = useProjectPermission(projectId, "edit_evaluation_queues")
    const remove = useQueueDelete()
    const setDefaultKind = useSetAtom(createQueueDrawerDefaultKindAtom)
    const setSelection = useSetAtom(createQueueDrawerSelectionAtom)
    const setSheetOpen = useSetAtom(createQueueDrawerOpenAtom)

    const openCreate = () => {
        setDefaultKind("traces")
        setSelection(null)
        setSheetOpen(true)
    }

    return (
        <>
            <PageTitle title={t("annotation.queueScreens.listTitle")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-heading text-foreground">
                                    Queues
                                </h1>
                                {canEdit ? (
                                    <Button size="sm" onClick={openCreate}>
                                        <PlusIcon aria-hidden />
                                        New queue
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <QueueListContent
                            rows={list.rows}
                            base={base}
                            isLoading={list.isLoading}
                            isError={list.isError}
                            hasMore={list.hasMore}
                            isLoadingMore={list.isLoadingMore}
                            search={list.search}
                            appliedSearch={list.appliedSearch}
                            kind={list.kind}
                            canEdit={canEdit}
                            onSearchChange={list.setSearch}
                            onClearSearch={list.clearSearch}
                            onKindChange={list.setKind}
                            onLoadMore={list.loadMore}
                            onRetry={() => void list.refetch()}
                            onCreate={openCreate}
                            onDelete={remove.requestDelete}
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            <AlertDialog
                open={remove.target !== null}
                onOpenChange={(next) => {
                    if (!next && !remove.isDeleting) remove.cancel()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Are you sure you want to delete the following?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-col gap-1 text-body">
                        <span className="text-meta text-muted-foreground">Annotation queue</span>
                        <span className="font-medium">
                            {remove.target?.name || "Untitled queue"}
                        </span>
                    </div>
                    {remove.error ? (
                        <p className="m-0 text-body text-destructive">{remove.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={remove.cancel}
                                disabled={remove.isDeleting}
                            >
                                {t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={remove.isDeleting}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void remove.confirm()
                                }}
                            >
                                {remove.isDeleting ? t("common.working") : "Delete"}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
