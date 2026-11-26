import type {EntityColumnHeader} from "@agenta/entity-ui/testcase"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeVertical, PencilSimple, Trash} from "@phosphor-icons/react"

/**
 * A column or group header with its menu. A column can be renamed or deleted; a group can only
 * be deleted, which deletes every column under it. `blockedReason` turns the menu off and
 * names the reason in its label.
 */
export const ColumnHeaderActions = ({
    header,
    blockedReason,
    onRename,
    onDelete,
}: {
    header: EntityColumnHeader
    blockedReason: string | null
    onRename: () => void
    onDelete: () => void
}) => (
    <div className="flex min-w-0 items-center justify-between gap-1">
        <span className="min-w-0 truncate" title={header.key}>
            {header.title}
        </span>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={blockedReason !== null}
                    title={blockedReason ?? undefined}
                    aria-label={
                        header.isGroup
                            ? `Group ${header.label} actions`
                            : `Column ${header.label} actions`
                    }
                    className="shrink-0"
                    onClick={(event) => event.stopPropagation()}
                >
                    <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
                {header.isGroup ? null : (
                    <DropdownMenuItem onSelect={onRename}>
                        <PencilSimple aria-hidden size={14} />
                        Rename column
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash aria-hidden size={14} />
                    {header.isGroup ? "Delete group" : "Delete column"}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    </div>
)
