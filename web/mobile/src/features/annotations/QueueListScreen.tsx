import {
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerOpenAtom,
    createQueueDrawerSelectionAtom,
} from "@agenta/annotation"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {Button} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import {Plus} from "lucide-react"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission} from "../context/useProjectPermission"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {QueueDeleteDialog} from "./QueueDeleteDialog"
import {QueueListContent} from "./QueueListContent"
import {useQueueDelete} from "./useQueueDelete"
import {useQueueList} from "./useQueueList"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/** The annotation queues of the project: search, type filter, the list and the delete confirm. */
export const QueueListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
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
            <PageTitle title="Annotation Queues" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Queues
                                </h1>
                                {canEdit ? (
                                    <Button
                                        className="h-control-sm rounded-control-sm px-btn-sm text-btn-sm sm:h-control sm:rounded-control sm:px-btn sm:text-btn-md"
                                        onClick={openCreate}
                                    >
                                        <Plus aria-hidden />
                                        New Queue
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
