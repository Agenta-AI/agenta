import {Button} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import {QueueDeleteDialog} from "./QueueDeleteDialog"
import {useQueueDelete} from "./useQueueDelete"

/** Deletes the queue after a confirm, then returns to the queue list. */
export const QueueDeleteCard = ({
    queueId,
    queueName,
    listHref,
}: {
    queueId: string
    queueName: string | null | undefined
    listHref: string
}) => {
    const router = useRouter()
    const remove = useQueueDelete({
        onDeleted: () => void router.push(listHref).catch(() => undefined),
    })
    return (
        <>
            <div className="flex flex-col gap-4 rounded-lg border border-solid border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                    <span className="text-label text-destructive">Delete queue</span>
                    <span className="text-body text-muted-foreground">
                        Permanently remove this annotation queue and return to the queue list.
                    </span>
                </div>
                <Button
                    type="button"
                    variant="destructive-ghost"
                    onClick={() => remove.requestDelete({id: queueId, name: queueName})}
                >
                    Delete queue
                </Button>
            </div>
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
