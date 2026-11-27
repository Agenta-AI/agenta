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
import {useRouter} from "next/router"

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
    const t = useT(commonCatalog)
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
