import {useCallback} from "react"

import {createT, useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
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
    DotsThree,
    DownloadSimple,
} from "@phosphor-icons/react"

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
 * for a GitHub import, where there is an upstream to check against.
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
    const {archive, restore, download} = useSkillActions()
    const {check} = useSkillUpdates()
    const {confirm, modal} = useConfirmModal()

    const onArchive = useCallback(() => {
        confirm({
            title: tNow("skills.list.archiveTitle", {name: row.title}),
            message: tNow("skills.list.archiveMessage"),
            onOk: () => archive(row.id),
        })
    }, [archive, confirm, row.id, row.title])

    return (
        <>
            <DropdownMenu>
                {/* The hover is not the default `accent`: on a list row the row itself hovers
                    to accent, so an accent button on top of it would read as no hover at all. */}
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("skills.list.skillActions")}
                    >
                        <DotsThree aria-hidden className="size-3.5" weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-popover-sm">
                    <DropdownMenuItem onSelect={() => onOpen(row)}>
                        <ArrowSquareOut aria-hidden size={14} />
                        {t("skills.list.openSkill")}
                    </DropdownMenuItem>
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
            {modal}
        </>
    )
}
