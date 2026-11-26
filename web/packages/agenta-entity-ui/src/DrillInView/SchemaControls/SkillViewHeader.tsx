/**
 * The header of the skill view (F07 f9, f10): the skill name, one status line, and the "..."
 * menu "Skill actions". The registry skill view (skills-ui) and the agent-only skill view
 * (entity-ui) both use it.
 */
import {Fragment, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import skillFormCatalog from "@agenta/i18n/catalogs/entityUi.skillForm"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {SkillMark} from "@agenta/ui/agent-icon"
import {BottomSheet, useIsPhone} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    ItemViewTitle,
    MENU_ITEM,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SimpleTooltip,
    type ItemViewTitleEditable,
} from "@agenta/ui/ui"
import {DotsThree, DownloadSimple} from "@phosphor-icons/react"

import {downloadSkill, skillDownloadKind} from "./skillDownload"

/** A menu row drawn as a plain button (a sheet, or a popover with a flyout): the kit's MENU_ITEM. */
const SKILL_ACTION_ROW_SHAPE = cn(
    MENU_ITEM,
    "appearance-none border-0 bg-transparent text-left font-[inherit] transition-colors duration-[var(--duration-fast)] hover:bg-accent focus-visible:bg-accent motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
)
export const SKILL_ACTION_ROW = `${SKILL_ACTION_ROW_SHAPE} text-foreground`
/** A danger row (F07 f10: Archive in red). */
const SKILL_DANGER_ROW = `${SKILL_ACTION_ROW_SHAPE} text-destructive`

export interface SkillAction {
    key: string
    label: string
    icon: ReactNode
    onSelect: () => void
    danger?: boolean
    disabled?: boolean
}

/** "Download" (a .zip or SKILL.md) for the "…" menu; none when there is nothing to download. */
export const useSkillDownloadAction = (skill: Record<string, unknown>): SkillAction[] => {
    const t = useT(skillFormCatalog)
    const kind = skillDownloadKind(skill)
    if (!kind) return []
    return [
        {
            key: "download",
            label: t("entityUi.skillForm.download"),
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
    /** Controls before the menu (the Files toggle). */
    end?: ReactNode
    /** The name is edited in place. */
    editable?: ItemViewTitleEditable
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
    end,
    editable,
}: SkillViewHeaderProps) {
    const t = useT(skillsGalleryCatalog)
    const [ownOpen, setOwnOpen] = useState(false)
    const open = menuOpen ?? ownOpen
    const setOpen = onMenuOpenChange ?? setOwnOpen
    const phone = useIsPhone()
    const hasMenu = actions.length > 0 || Boolean(menuTop)
    // The menu renders inside the header, so a modal drawer around it keeps it scrollable.
    const [headerRoot, setHeaderRoot] = useState<HTMLDivElement | null>(null)
    const menuLabel = t("skills.gallery.skillActions")
    const trigger = (
        <Button
            variant="ghost"
            size="icon-compact"
            aria-label={menuLabel}
            disabled={busy}
            className="shrink-0"
        >
            <DotsThree aria-hidden />
        </Button>
    )
    // A line before the first danger action (F07 f10: before Archive).
    const lineBefore = (index: number) =>
        Boolean(actions[index].danger) && index > 0 && !actions[index - 1].danger
    // Plain rows, for the phone sheet and for the popover that holds a flyout (`menuTop`).
    const buttonRows = actions.map((action, index) => (
        <Fragment key={action.key}>
            {lineBefore(index) ? (
                <span role="separator" className="mx-1 my-1 h-px shrink-0 bg-border-muted" />
            ) : null}
            <button
                type="button"
                disabled={action.disabled}
                onClick={() => {
                    setOpen(false)
                    action.onSelect()
                }}
                className={action.danger ? SKILL_DANGER_ROW : SKILL_ACTION_ROW}
            >
                {action.icon}
                <span className="flex-1">{action.label}</span>
            </button>
        </Fragment>
    ))
    const menu = !hasMenu ? null : phone ? (
        <BottomSheet
            open={open}
            onOpenChange={setOpen}
            title={menuLabel}
            trigger={trigger}
        >
            <div className="flex flex-col px-2">
                {menuTop}
                {buttonRows}
            </div>
        </BottomSheet>
    ) : menuTop ? (
        // A flyout row (the registry's "Add to agent") needs a popover: a menu closes on it.
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
                align="end"
                sideOffset={6}
                container={headerRoot}
                className="flex w-popover-sm flex-col p-1"
            >
                {menuTop}
                {buttonRows}
            </PopoverContent>
        </Popover>
    ) : (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                sideOffset={6}
                container={headerRoot}
                className="w-popover-sm"
            >
                {actions.map((action, index) => (
                    <Fragment key={action.key}>
                        {lineBefore(index) ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem
                            variant={action.danger ? "destructive" : "default"}
                            disabled={action.disabled}
                            onSelect={action.onSelect}
                        >
                            {action.icon}
                            <span className="flex-1">{action.label}</span>
                        </DropdownMenuItem>
                    </Fragment>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
    return (
        <div ref={setHeaderRoot} className="flex shrink-0 flex-col gap-1 px-4 pb-2 pt-4">
            <ItemViewTitle
                mark={<SkillMark size={24} />}
                title={name}
                editable={editable}
                status={extra}
                description={status}
                actions={
                    end || menu ? (
                        <>
                            {end}
                            {menu ? (
                                <SimpleTooltip title={menuLabel}>
                                    <span className="inline-flex">{menu}</span>
                                </SimpleTooltip>
                            ) : null}
                        </>
                    ) : null
                }
            />
            {error ? <span className="text-meta text-destructive">{error}</span> : null}
        </div>
    )
}
