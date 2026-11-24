import {
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerOpenAtom,
    createQueueDrawerSelectionAtom,
} from "@agenta/annotation"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {Button} from "@agenta/ui/ui"
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

import {QueueDeleteDialog} from "./QueueDeleteDialog"
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
    const t = useT(queueScreensCatalog)
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
            <QueueDeleteDialog
                target={remove.target}
                pending={remove.isDeleting}
                error={remove.error}
                onConfirm={() => void remove.confirm()}
                onClose={remove.cancel}
            />
        </>
    )
}
