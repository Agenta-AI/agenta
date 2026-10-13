/** A connection row's kebab: Refresh, Revoke and Delete, the same verbs Settings offers. */
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ArrowClockwise, DotsThreeVertical, Trash, XCircle} from "@phosphor-icons/react"

export function ConnectionRowMenu({
    onRefresh,
    onRevoke,
    onDelete,
}: {
    onRefresh: () => void
    onRevoke: () => void
    onDelete: () => void
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Connection actions"
                    // Shown on row hover where there is hover; always on touch. The row already
                    // hovers to accent, so the button's own hover is a foreground wash.
                    className="hover:bg-foreground/10 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 dark:hover:bg-foreground/15 [@media(hover:hover)]:opacity-0"
                >
                    <DotsThreeVertical aria-hidden weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
                <DropdownMenuItem onSelect={onRefresh}>
                    <ArrowClockwise size={14} />
                    Refresh
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onRevoke}>
                    <XCircle size={14} />
                    Revoke
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash size={14} />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
