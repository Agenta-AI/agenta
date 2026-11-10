import {annotationSessionController} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission} from "../context/useProjectPermission"
import {AppShell} from "../nav/AppShell"

import {QueueSessionBody} from "./QueueSessionBody"
import {QueueSessionTabs} from "./QueueSessionTabs"
import {useAddToTestsetToast} from "./useAddToTestsetToast"
import {useQueueSessionRoute} from "./useQueueSessionRoute"

// The modal pulls the commit flow and the testset picker; it loads the first time it opens.
const AddToTestsetModal = dynamic(
    () => import("./AddToTestsetModal").then((m) => m.AddToTestsetModal),
    {ssr: false},
)

/** One annotation queue: the header with its three views, and the view below it. */
export const QueueSessionScreen = ({
    workspaceId,
    projectId,
    queueId,
}: {
    workspaceId: string
    projectId: string
    queueId: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const {view, setView} = useQueueSessionRoute(queueId)
    const canEdit = useProjectPermission(projectId, "edit_evaluation_queues")
    const queueQuery = useAtomValue(simpleQueueMolecule.selectors.query(queueId))
    const queueName = useAtomValue(annotationSessionController.selectors.queueName())
    const modalOpen = useAtomValue(annotationSessionController.selectors.isAddToTestsetModalOpen())
    useAddToTestsetToast(base)

    const title = queueName || "Untitled Queue"
    return (
        <>
            <PageTitle title={queueQuery.data ? title : "Annotation Queues"} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    header={
                        <div className="box-border flex shrink-0 flex-col gap-3 border-0 border-b border-solid border-border px-4 pb-2 pt-3 sm:flex-row sm:items-center">
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <Button size="icon-sm" variant="ghost" asChild>
                                    <Link
                                        href={`${base}/annotations`}
                                        prefetch={false}
                                        aria-label="Back to queues"
                                    >
                                        <ArrowLeft aria-hidden size={16} />
                                    </Link>
                                </Button>
                                {queueQuery.isPending ? (
                                    <SkeletonBlock className="h-5 w-48" />
                                ) : queueQuery.data ? (
                                    <h1 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[20px]">
                                        {title}
                                    </h1>
                                ) : null}
                            </div>
                            {queueQuery.data ? (
                                <QueueSessionTabs view={view} onChange={setView} />
                            ) : null}
                        </div>
                    }
                >
                    <QueueSessionBody
                        queueId={queueId}
                        base={base}
                        view={view}
                        canEdit={canEdit}
                        onViewChange={setView}
                    />
                </ScreenScaffold>
            </AppShell>
            {modalOpen ? <AddToTestsetModal queueId={queueId} queueName={title} /> : null}
        </>
    )
}
