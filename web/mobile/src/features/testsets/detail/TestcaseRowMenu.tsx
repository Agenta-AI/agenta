import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Copy, DotsThreeVertical, PencilSimple, Trash} from "@phosphor-icons/react"

/**
 * The kebab on a testcase row. "Delete" shows only to a reader who may edit, and is off while
 * a save runs. A row that is not saved yet has no id to copy.
 */
export const TestcaseRowMenu = ({
    isNewRow,
    canEdit,
    deleteDisabled,
    onEdit,
    onDelete,
    onCopyId,
}: {
    isNewRow: boolean
    canEdit: boolean
    deleteDisabled: boolean
    onEdit: () => void
    onDelete: () => void
    onCopyId: () => void
}) => (
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
        >
            <DropdownMenuItem onSelect={onEdit}>
                <PencilSimple aria-hidden size={14} />
                {canEdit ? "Edit" : "View"}
            </DropdownMenuItem>
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
)
