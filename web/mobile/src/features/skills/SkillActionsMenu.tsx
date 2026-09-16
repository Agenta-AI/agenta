import {useCallback} from "react"

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
} from "@phosphor-icons/react"

import {useConfirmModal} from "../settings/useConfirmModal"

import type {SkillListRow} from "./skillListView"
import {useSkillActions} from "./useSkillActions"
import {useSkillUpdates} from "./useSkillUpdates"

/**
 * A skill's own actions — the row's only control, and a card's.
 *
 * A kebab, because none of these is a thing to do often and one of them puts the skill away.
 * Archive goes through the same confirm modal every destructive action on this app uses and
 * names the skill, so it is never a generic "are you sure". Check for updates is only offered
 * where there is an upstream to check against.
 */
export const SkillActionsMenu = ({
    row,
    onOpen,
}: {
    row: SkillListRow
    /** The row's own click already does this; the menu offers it in words. */
    onOpen: (row: SkillListRow) => void
}) => {
    const {archive, restore} = useSkillActions()
    const {check} = useSkillUpdates()
    const {confirm, modal} = useConfirmModal()

    const onArchive = useCallback(() => {
        confirm({
            title: `Archive ${row.slug}?`,
            message:
                "It leaves the registry and agents can no longer run it. Its name stays reserved, " +
                "and restoring it brings back its full history.",
            onOk: () => archive(row.id),
        })
    }, [archive, confirm, row.id, row.slug])

    return (
        <>
            <DropdownMenu>
                {/* The hover is not the default `accent`: on a list row the row itself hovers to
                    accent, so an accent button on top of it would read as no hover at all. */}
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Skill actions"
                        className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
                    >
                        <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
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
                    <DropdownMenuSeparator />
                    {row.archived ? (
                        <DropdownMenuItem onSelect={() => void restore(row.id)}>
                            <ArrowUUpLeft aria-hidden size={14} />
                            Restore
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                            <Archive aria-hidden size={14} />
                            Archive
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {modal}
        </>
    )
}
