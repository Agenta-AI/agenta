import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import type {SkillOriginInfo} from "@agenta/skills"
import {LoadingButton, SimpleTooltip} from "@agenta/ui/composed"
import {useIsExpandedWindow} from "@agenta/ui/hooks"
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
    ArrowCounterClockwise,
    ArrowsClockwise,
    ArrowSquareOut,
    ArrowUUpLeft,
    DotsThree,
    DownloadSimple,
} from "@phosphor-icons/react"

import {skillGithubUrl} from "./skillRoutes"

/** The skill page's actions: Discard and Save while there are edits, then the ⋯ menu. */
export const SkillPageActions = ({
    editable,
    dirty,
    canSave,
    saving,
    archived,
    builtin,
    origin,
    onDiscard,
    onSave,
    onCheck,
    onDownload,
    onArchive,
    onRestore,
    filesSlot,
}: {
    editable: boolean
    dirty: boolean
    canSave: boolean
    saving: boolean
    archived: boolean
    builtin: boolean
    origin: SkillOriginInfo | null
    onDiscard: () => void
    onSave: () => void
    onCheck: () => void
    onDownload: () => void
    onArchive: () => void
    onRestore: () => void
    /** The editor's Files toggle, right after Save. */
    filesSlot?: ReactNode
}) => {
    const t = useT(skillsPageCatalog)
    const expanded = useIsExpandedWindow()
    return (
        // Grouped buttons sit 4px apart (SPACE-02).
        <div className="flex items-center gap-1">
            {/* A narrow window's bar holds at most two actions (COMPACT-02): Discard moves to ⋯. */}
            {editable && dirty && expanded ? (
                <Button variant="outline" onClick={onDiscard} disabled={saving}>
                    {t("skills.page.discard")}
                </Button>
            ) : null}
            {editable ? (
                <LoadingButton onClick={onSave} loading={saving} disabled={!dirty}>
                    {t("skills.page.save")}
                </LoadingButton>
            ) : null}
            {filesSlot}
            <DropdownMenu>
                <SimpleTooltip title={t("skills.page.moreActions")}>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("skills.page.moreActions")}
                        >
                            <DotsThree />
                        </Button>
                    </DropdownMenuTrigger>
                </SimpleTooltip>
                <DropdownMenuContent align="end" collisionPadding={16} className="w-popover-sm">
                    {editable && dirty && !expanded ? (
                        <>
                            <DropdownMenuItem onSelect={onDiscard} disabled={saving}>
                                <ArrowCounterClockwise />
                                {t("skills.page.discard")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                        </>
                    ) : null}
                    {origin?.repository ? (
                        <DropdownMenuItem onSelect={onCheck}>
                            <ArrowsClockwise />
                            {t("skills.page.checkForUpdates")}
                        </DropdownMenuItem>
                    ) : null}
                    {builtin ? null : (
                        <DropdownMenuItem onSelect={onDownload}>
                            <DownloadSimple />
                            {t("skills.page.download")}
                        </DropdownMenuItem>
                    )}
                    {origin?.repository ? (
                        <DropdownMenuItem asChild>
                            <a href={skillGithubUrl(origin)} target="_blank" rel="noreferrer">
                                <ArrowSquareOut />
                                {t("skills.page.openOnGithub")}
                            </a>
                        </DropdownMenuItem>
                    ) : null}
                    {builtin ? null : (
                        <>
                            <DropdownMenuSeparator />
                            {archived ? (
                                <DropdownMenuItem onSelect={onRestore}>
                                    <ArrowUUpLeft />
                                    {t("skills.page.restore")}
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                                    <Archive />
                                    {t("skills.page.archive")}
                                </DropdownMenuItem>
                            )}
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
