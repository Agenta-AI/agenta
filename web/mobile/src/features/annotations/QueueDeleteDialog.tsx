import {ConfirmModal} from "../settings/ConfirmModal"

import type {QueueToDelete} from "./useQueueDelete"

export const QueueDeleteDialog = ({
    target,
    pending,
    error,
    onConfirm,
    onClose,
}: {
    target: QueueToDelete | null
    pending: boolean
    error: string | null
    onConfirm: () => void
    onClose: () => void
}) => (
    <ConfirmModal
        open={target !== null}
        title="Are you sure you want to delete the following?"
        description="This action cannot be undone."
        body={
            <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Annotation queue</span>
                <span className="font-medium">{target?.name || "Untitled queue"}</span>
            </div>
        }
        confirmLabel="Delete"
        pending={pending}
        error={error}
        onConfirm={onConfirm}
        onClose={onClose}
    />
)
