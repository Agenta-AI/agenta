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
    SimpleTooltip,
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

/** A skill's kebab menu on a row or a card; Check for updates only for a GitHub import. */
export const SkillActionsMenu = ({
    row,
    onOpen,
}: {
    row: SkillListRow
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
            okText: tNow("skills.list.archive"),
            danger: true,
            onOk: () => archive(row.id),
        })
    }, [archive, confirm, row.id, row.title])

    return (
        <>
            <DropdownMenu>
                {/* The span takes the tooltip, so two asChild triggers do not share one element. */}
                <SimpleTooltip title={t("skills.list.skillActions")}>
                    <span className="inline-flex">
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t("skills.list.skillActions")}
                            >
                                <DotsThree aria-hidden />
                            </Button>
                        </DropdownMenuTrigger>
                    </span>
                </SimpleTooltip>
                <DropdownMenuContent align="end" className="w-popover-sm">
                    <DropdownMenuItem onSelect={() => onOpen(row)}>
                        <ArrowSquareOut aria-hidden />
                        {t("skills.list.openSkill")}
                    </DropdownMenuItem>
                    {row.origin === "imported" ? (
                        <DropdownMenuItem onSelect={() => void check([row.id])}>
                            <ArrowsClockwise aria-hidden />
                            {t("skills.list.checkForUpdates")}
                        </DropdownMenuItem>
                    ) : null}
                    {row.item.origin === "builtin" ? null : (
                        <DropdownMenuItem onSelect={() => void download(row.id)}>
                            <DownloadSimple aria-hidden />
                            {t("skills.list.download")}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {row.archived ? (
                        <DropdownMenuItem onSelect={() => void restore(row.id)}>
                            <ArrowUUpLeft aria-hidden />
                            {t("skills.list.restore")}
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                            <Archive aria-hidden />
                            {t("skills.list.archive")}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {modal}
        </>
    )
}
