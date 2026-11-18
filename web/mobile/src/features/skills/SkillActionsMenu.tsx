import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    Archive,
    ArrowsClockwise,
    ArrowSquareOut,
    ArrowUUpLeft,
    DotsThreeVertical,
    DownloadSimple,
} from "@phosphor-icons/react"

import type {SkillListRow} from "./skillListView"
import {useSkillActions} from "./useSkillActions"
import {useSkillUpdates} from "./useSkillUpdates"

/** A skill's own actions, on its row and its card. */
export const SkillActionsMenu = ({
    row,
    onOpen,
    onArchive,
}: {
    row: SkillListRow
    onOpen: (row: SkillListRow) => void
    onArchive: (row: SkillListRow) => void
}) => {
    const {restore, download} = useSkillActions()
    const {check} = useSkillUpdates()

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Actions for ${row.title}`}
                    className="text-muted-foreground hover:bg-foreground/10 dark:hover:bg-foreground/15"
                >
                    <DotsThreeVertical aria-hidden className="size-4" weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
                <DropdownMenuItem onSelect={() => onOpen(row)}>
                    <ArrowSquareOut aria-hidden size={14} />
                    Open skill
                </DropdownMenuItem>
                {row.origin === "imported" ? (
                    <DropdownMenuItem onSelect={() => void check([row.id])}>
                        <ArrowsClockwise aria-hidden size={14} />
                        Check for updates
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => void download(row.id)}>
                    <DownloadSimple aria-hidden size={14} />
                    Download
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {row.archived ? (
                    <DropdownMenuItem onSelect={() => void restore([row.id])}>
                        <ArrowUUpLeft aria-hidden size={14} />
                        Restore
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem variant="destructive" onSelect={() => onArchive(row)}>
                        <Archive aria-hidden size={14} />
                        Archive
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
