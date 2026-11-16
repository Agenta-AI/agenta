import {useCallback, useState} from "react"

import {createT, useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {projectIdAtom} from "@agenta/shared/state"
import {SkillAgentPicker} from "@agenta/skills-ui"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Popover,
    PopoverAnchor,
    PopoverContent,
} from "@agenta/ui/ui"
import {
    Archive,
    ArrowsClockwise,
    ArrowSquareOut,
    ArrowUUpLeft,
    DotsThreeVertical,
    DownloadSimple,
    Plus,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useConfirmModal} from "../settings/useConfirmModal"

import type {SkillListRow} from "./skillListView"
import {useSkillActions} from "./useSkillActions"
import {useSkillUpdates} from "./useSkillUpdates"

const tNow = createT(skillsListCatalog)

/**
 * A skill's own actions — the row's only control, and a card's.
 *
 * A kebab, because none of these is a thing to do often and one of them puts the skill away.
 * Archive goes through the same confirm modal every destructive action on this app uses and
 * names the skill, so it is never a generic "are you sure". Check for updates is only offered
 * where there is an upstream to check against.
 *
 * Add to agent hands off to a popover on the same kebab — the agent picker the detail drawer's
 * kebab opens — because the picker carries a search field a menu's typeahead would fight.
 */
export const SkillActionsMenu = ({
    row,
    onOpen,
}: {
    row: SkillListRow
    /** The row's own click already does this; the menu offers it in words. */
    onOpen: (row: SkillListRow) => void
}) => {
    const t = useT(skillsListCatalog)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const {archive, restore, download} = useSkillActions()
    const {check} = useSkillUpdates()
    const {confirm, modal} = useConfirmModal()
    const [agentsOpen, setAgentsOpen] = useState(false)

    const onArchive = useCallback(() => {
        confirm({
            title: tNow("skills.list.archiveTitle", {slug: row.slug}),
            message: tNow("skills.list.archiveMessage"),
            onOk: () => archive(row.id),
        })
    }, [archive, confirm, row.id, row.slug])

    return (
        <>
            {/* The picker anchors to the kebab itself, so it opens where the menu just was. */}
            <Popover open={agentsOpen} onOpenChange={setAgentsOpen}>
                <DropdownMenu>
                    {/* The hover is not the default `accent`: on a list row the row itself hovers
                        to accent, so an accent button on top of it would read as no hover at all. */}
                    <PopoverAnchor asChild>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t("skills.list.skillActions")}
                                className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
                            >
                                <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
                            </Button>
                        </DropdownMenuTrigger>
                    </PopoverAnchor>
                    <DropdownMenuContent align="end" className="w-[200px]">
                        <DropdownMenuItem onSelect={() => onOpen(row)}>
                            <ArrowSquareOut aria-hidden size={14} />
                            {t("skills.list.openSkill")}
                        </DropdownMenuItem>
                        {row.archived ? null : (
                            <DropdownMenuItem
                                // A frame late: the menu's close returns focus to the kebab, and a
                                // popover already open would read that as focus leaving it.
                                onSelect={() => requestAnimationFrame(() => setAgentsOpen(true))}
                            >
                                <Plus aria-hidden size={14} />
                                {t("skills.list.addToAgent")}
                            </DropdownMenuItem>
                        )}
                        {row.origin === "imported" ? (
                            <DropdownMenuItem onSelect={() => void check([row.id])}>
                                <ArrowsClockwise aria-hidden size={14} />
                                {t("skills.list.checkForUpdates")}
                            </DropdownMenuItem>
                        ) : null}
                        {row.item.origin === "builtin" ? null : (
                            <DropdownMenuItem onSelect={() => void download(row.id)}>
                                <DownloadSimple aria-hidden size={14} />
                                {t("skills.list.download")}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {row.archived ? (
                            <DropdownMenuItem onSelect={() => void restore(row.id)}>
                                <ArrowUUpLeft aria-hidden size={14} />
                                {t("skills.list.restore")}
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                                <Archive aria-hidden size={14} />
                                {t("skills.list.archive")}
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
                <PopoverContent
                    align="end"
                    sideOffset={6}
                    aria-label={t("skills.list.addToAgent")}
                    className="flex w-[280px] flex-col gap-0 p-0"
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onFocusOutside={(event) => event.preventDefault()}
                    // The row underneath opens the drawer on click; the picker's clicks are its own.
                    onClick={(event) => event.stopPropagation()}
                >
                    <SkillAgentPicker projectId={projectId} skill={row.item} />
                </PopoverContent>
            </Popover>
            {modal}
        </>
    )
}
