import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import type {SkillOriginInfo} from "@agenta/skills"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Spinner,
} from "@agenta/ui/ui"
import {
    Archive,
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
    return (
        // Grouped buttons sit 4px apart (SPACE-02).
        <div className="flex items-center gap-1">
            {editable && dirty ? (
                <Button variant="outline" onClick={onDiscard} disabled={saving}>
                    {t("skills.page.discard")}
                </Button>
            ) : null}
            {editable ? (
                <Button onClick={onSave} disabled={!dirty || !canSave || saving}>
                    {saving ? <Spinner size="small" /> : null}
                    {t("skills.page.save")}
                </Button>
            ) : null}
            {filesSlot}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("skills.page.moreActions")}>
                        <DotsThree weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" collisionPadding={16}>
                    {origin?.repository ? (
                        <DropdownMenuItem onSelect={onCheck}>
                            <ArrowsClockwise />
                            {t("skills.page.checkForUpdates")}
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={onDownload}>
                        <DownloadSimple />
                        {t("skills.page.download")}
                    </DropdownMenuItem>
                    {origin?.repository ? (
                        <DropdownMenuItem asChild>
                            <a href={skillGithubUrl(origin)} target="_blank" rel="noreferrer">
                                <ArrowSquareOut />
                                {t("skills.page.viewOnGithub")}
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
