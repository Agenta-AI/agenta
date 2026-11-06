import {useRef, useState} from "react"

import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Copy, DotsThreeVertical, ListChecks, PencilSimple, Trash} from "@phosphor-icons/react"

import {TestcaseQueuePicker} from "./TestcaseQueuePicker"

/**
 * The kebab on a testcase row, in the old app's order: Edit, Add annotation queue, Copy ID,
 * Delete. "Add annotation queue" and "Delete" show only to a reader who may edit, and Delete
 * is off while a save runs. A row that is not saved yet has no id to copy or to queue.
 */
export const TestcaseRowMenu = ({
    rowId,
    isNewRow,
    canEdit,
    deleteDisabled,
    onEdit,
    onDelete,
    onCopyId,
}: {
    rowId: string
    isNewRow: boolean
    canEdit: boolean
    deleteDisabled: boolean
    onEdit: () => void
    onDelete: () => void
    onCopyId: () => void
}) => {
    const [queueOpen, setQueueOpen] = useState(false)
    // The menu gives focus back to its button as it closes. When it closes to open the queue
    // picker, that focus would count as outside the picker and close it at once.
    const openingQueue = useRef(false)
    return (
        <span className="relative inline-flex">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Actions"
                        // The row opens the drawer on click; the menu must not.
                        onClick={(event) => event.stopPropagation()}
                    >
                        <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="end"
                    className="w-[180px]"
                    onClick={(event) => event.stopPropagation()}
                    onCloseAutoFocus={(event) => {
                        if (!openingQueue.current) return
                        openingQueue.current = false
                        event.preventDefault()
                    }}
                >
                    <DropdownMenuItem onSelect={onEdit}>
                        <PencilSimple aria-hidden size={14} />
                        {canEdit ? "Edit" : "View"}
                    </DropdownMenuItem>
                    {canEdit && !isNewRow ? (
                        <DropdownMenuItem
                            onSelect={() => {
                                openingQueue.current = true
                                setQueueOpen(true)
                            }}
                        >
                            <ListChecks aria-hidden size={14} />
                            Add annotation queue
                        </DropdownMenuItem>
                    ) : null}
                    {isNewRow ? null : (
                        <DropdownMenuItem onSelect={onCopyId}>
                            <Copy aria-hidden size={14} />
                            Copy ID
                        </DropdownMenuItem>
                    )}
                    {canEdit ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant="destructive"
                                disabled={deleteDisabled}
                                onSelect={onDelete}
                            >
                                <Trash aria-hidden size={14} />
                                Delete
                            </DropdownMenuItem>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
            <TestcaseQueuePicker itemIds={[rowId]} open={queueOpen} onOpenChange={setQueueOpen} />
        </span>
    )
}
