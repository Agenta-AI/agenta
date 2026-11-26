import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {ArrowSquareOut, ChartBar, Copy, DotsThreeVertical, Trash} from "@phosphor-icons/react"

import type {QueueToDelete} from "./useQueueDelete"

/**
 * The row's actions: Open, View Results (as in the old app), Copy ID and Delete. Delete shows only to a reader who may delete queues; the dialog and the
 * request belong to `useQueueDelete`, so the menu only names the queue.
 */
export const QueueRowMenu = ({
    queue,
    canDelete,
    onOpen,
    onViewResults,
    onDelete,
}: {
    queue: QueueToDelete
    canDelete: boolean
    onOpen: () => void
    /** Opens the evaluation results of the queue's run; absent when there is nothing to open. */
    onViewResults?: () => void
    onDelete: (queue: QueueToDelete) => void
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Queue actions"
                className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
            >
                <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[180px]">
            <DropdownMenuItem onSelect={onOpen}>
                <ArrowSquareOut aria-hidden size={14} />
                Open
            </DropdownMenuItem>
            {onViewResults ? (
                <DropdownMenuItem onSelect={onViewResults}>
                    <ChartBar aria-hidden size={14} />
                    View Results
                </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
                onSelect={() => {
                    void copyToClipboard(queue.id).then((copied) => {
                        if (copied) message.success("Copied")
                    })
                }}
            >
                <Copy aria-hidden size={14} />
                Copy ID
            </DropdownMenuItem>
            {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(queue)}>
                    <Trash aria-hidden size={14} />
                    Delete
                </DropdownMenuItem>
            ) : null}
        </DropdownMenuContent>
    </DropdownMenu>
)
