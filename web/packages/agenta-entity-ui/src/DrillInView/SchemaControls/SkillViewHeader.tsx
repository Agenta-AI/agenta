/**
 * The header of the skill view (F07 f9, f10): the skill name, one status line, and the "..."
 * menu "Skill actions". The registry skill view (skills-ui) and the agent-only skill view
 * (entity-ui) both use it.
 */
import {useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import skillFormCatalog from "@agenta/i18n/catalogs/entityUi.skillForm"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {SkillMark} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/styles"
import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {DotsThreeVertical, DownloadSimple} from "@phosphor-icons/react"

import {downloadSkill, skillDownloadKind} from "./skillDownload"

/** A row of the actions menu: icon, label, full width. */
export const SKILL_ACTION_ROW =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-2 rounded-control-sm border-0 bg-transparent px-2 py-1.5 text-left font-[inherit] text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:opacity-50"

export interface SkillAction {
    key: string
    label: string
    icon: ReactNode
    onSelect: () => void
    danger?: boolean
    disabled?: boolean
}

/** "Download as .zip" (or "Download SKILL.md") for the "…" menu; none when there is nothing to download. */
export const useSkillDownloadAction = (skill: Record<string, unknown>): SkillAction[] => {
    const t = useT(skillFormCatalog)
    const kind = skillDownloadKind(skill)
    if (!kind) return []
    return [
        {
            key: "download",
            label:
                kind === "zip"
                    ? t("entityUi.skillForm.downloadZip")
                    : t("entityUi.skillForm.downloadSkillMd"),
            icon: <DownloadSimple size={14} className="text-muted-foreground" />,
            onSelect: () => void downloadSkill(skill),
        },
    ]
}

export interface SkillViewHeaderProps {
    name: string
    /** One line under the name, for example "Only available to this agent". */
    status?: ReactNode
    /** Text after the name, for example "Used by 3 agents" on the Skills page. */
    extra?: ReactNode
    actions: SkillAction[]
    /** Rows above the actions that need their own markup (the "Add to agent" flyout). */
    menuTop?: ReactNode
    /** The menu stays shut while something runs. */
    busy?: boolean
    /** An error under the header. */
    error?: ReactNode
    /** The open state of the menu, for a host whose rows open a flyout. */
    menuOpen?: boolean
    onMenuOpenChange?: (open: boolean) => void
}

export function SkillViewHeader({
    name,
    status,
    extra,
    actions,
    menuTop,
    busy,
    error,
    menuOpen,
    onMenuOpenChange,
}: SkillViewHeaderProps) {
    const t = useT(skillsGalleryCatalog)
    const [ownOpen, setOwnOpen] = useState(false)
    const open = menuOpen ?? ownOpen
    const setOpen = onMenuOpenChange ?? setOwnOpen
    const hasMenu = actions.length > 0 || Boolean(menuTop)
    return (
        <div className="flex shrink-0 flex-col gap-1 px-4 pb-3 pt-3">
            <div className="flex min-w-0 items-start gap-2">
                <SkillMark size={24} />
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex min-w-0 items-center gap-2">
                        <span title={name} className="min-w-0 truncate text-sm font-medium">
                            {name}
                        </span>
                        {extra}
                    </div>
                    {status ? (
                        <span className="text-xs text-muted-foreground">{status}</span>
                    ) : null}
                </div>
                {hasMenu ? (
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("skills.gallery.skillActions")}
                                disabled={busy}
                                className="-my-1 shrink-0"
                            >
                                <DotsThreeVertical aria-hidden className="size-4" weight="bold" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            sideOffset={6}
                            className="flex w-[220px] flex-col p-1"
                        >
                            {menuTop}
                            {actions.map((action) => (
                                <button
                                    key={action.key}
                                    type="button"
                                    disabled={action.disabled}
                                    onClick={() => {
                                        setOpen(false)
                                        action.onSelect()
                                    }}
                                    className={cn(
                                        SKILL_ACTION_ROW,
                                        action.danger && "text-[var(--ag-colorError)]",
                                    )}
                                >
                                    {action.icon}
                                    <span className="flex-1">{action.label}</span>
                                </button>
                            ))}
                        </PopoverContent>
                    </Popover>
                ) : null}
            </div>
            {error ? <span className="text-xs text-[var(--ag-colorError)]">{error}</span> : null}
        </div>
    )
}
