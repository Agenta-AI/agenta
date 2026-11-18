import {useCallback, useMemo, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {InitialsAvatar} from "@agenta/ui/components/presentational"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {
    ArrowLeft,
    ArrowsLeftRight,
    CaretDown,
    CaretRight,
    CaretUpDown,
    Check,
    GearSix,
    Plus,
    SignOut,
    X,
} from "@phosphor-icons/react"
import clsx from "clsx"

export interface SwitcherEntry {
    key: string
    name: string
    isActive: boolean
    onSelect: () => void
}

export interface SwitcherThemeOption {
    mode: string
    label: string
    /** Compact label shown as the current value on the trigger row. */
    short: string
    icon: ReactNode
}

export interface SwitcherThemeControl {
    options: SwitcherThemeOption[]
    mode: string
    onSelect: (mode: string) => void
}

export interface ProjectOrgSwitcherViewProps {
    collapsed: boolean
    projectLabel: string
    orgLabel: string
    projects: SwitcherEntry[]
    orgs: SwitcherEntry[]
    /** Where the panel portals. A drawer passes an element INSIDE its sheet: a modal sheet's
     * scroll lock blocks scrolling in portals outside its subtree. */
    panelContainer?: HTMLElement | null
    /** Theme fly-out row above logout — omit and no theme control renders. */
    theme?: SwitcherThemeControl
    /** Rendered beside the trigger on the expanded rail. */
    trailing?: ReactNode
    /** Where the panel opens: "bottom" when the switcher sits in the rail's header. */
    side?: "top" | "bottom"
    /** Quiet text inside the expanded trigger, before the caret (the app version). */
    triggerMeta?: ReactNode
    /** Optional rows — absent handlers render nothing, so a shell offers what it supports. */
    onCreateProject?: () => void
    onCreateOrg?: () => void
    onOrgSettings?: () => void
    onLogout?: () => void
}

type Panel = "projects" | "orgs"

export const ROW_CLASS =
    "flex w-full items-center gap-2 h-8 px-2 rounded-md text-sm leading-none text-left cursor-pointer border-0 bg-transparent [font-family:inherit] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-colorPrimary text-colorText hover:bg-colorFillTertiary transition-colors"

/** shrink-0 stops the capped scroll list from compressing rows instead of scrolling. */
export const ITEM_ROW_CLASS = "shrink-0"

export const CAPTION_CLASS = "px-2 pt-1.5 pb-1 text-xs font-medium text-colorTextTertiary truncate"

const Row = ({
    onClick,
    className,
    children,
    title,
}: {
    onClick?: () => void
    className?: string
    children: ReactNode
    title?: string
}) => (
    <button type="button" onClick={onClick} className={clsx(ROW_CLASS, className)} title={title}>
        {children}
    </button>
)

/** Theme picker as a hover fly-out row; the Preferences tab offers the same choices. */
const ThemeFlyout = ({theme}: {theme: SwitcherThemeControl}) => {
    const t = useT(navigationCatalog)
    const current = theme.options.find(({mode}) => mode === theme.mode) ?? theme.options[0]
    if (!current) return null
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className={ROW_CLASS}>
                    {current.icon}
                    <span className="flex-1">{t("navigation.projectMenu.theme")}</span>
                    <span className="text-colorTextSecondary">{current.short}</span>
                    <CaretRight size={14} className="shrink-0 text-colorTextSecondary" />
                </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-[190px] p-1">
                {theme.options.map(({mode, label, icon}) => (
                    <Row key={mode} className={ITEM_ROW_CLASS} onClick={() => theme.onSelect(mode)}>
                        {icon}
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {theme.mode === mode && (
                            <Check size={14} className="shrink-0 text-colorText" />
                        )}
                    </Row>
                ))}
            </PopoverContent>
        </Popover>
    )
}

export const EntryList = ({entries, close}: {entries: SwitcherEntry[]; close: () => void}) => (
    // Cap the list at 7 item rows (h-8 each) so the actions below it stay on screen.
    <div className="ag-scroll-quiet flex max-h-56 flex-col overflow-y-auto">
        {entries.map((entry) => (
            <Row
                key={entry.key}
                className={clsx(
                    ITEM_ROW_CLASS,
                    // scroll-initial-target is Chromium-only; elsewhere the list opens at the top.
                    entry.isActive && "bg-colorFillSecondary [scroll-initial-target:nearest]",
                )}
                onClick={() => {
                    close()
                    if (!entry.isActive) entry.onSelect()
                }}
            >
                <InitialsAvatar size="small" name={entry.name} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.isActive && <Check size={14} className="shrink-0 text-colorText" />}
            </Row>
        ))}
    </div>
)

/**
 * The rail's project/org switcher: a two-panel popup (projects, then organizations behind
 * "Switch organization") docked at the trigger. Data and actions arrive as props.
 */
export const ProjectOrgSwitcherView = ({
    collapsed,
    projectLabel,
    orgLabel,
    projects,
    orgs,
    panelContainer,
    theme,
    trailing,
    side = "top",
    triggerMeta,
    onCreateProject,
    onCreateOrg,
    onOrgSettings,
    onLogout,
}: ProjectOrgSwitcherViewProps) => {
    const t = useT(navigationCatalog, commonCatalog)
    const [open, setOpen] = useState(false)
    const [panel, setPanel] = useState<Panel>("projects")

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next)
        if (!next) setPanel("projects")
    }, [])

    const close = useCallback(() => {
        setOpen(false)
        setPanel("projects")
    }, [])

    const projectPanel = useMemo(
        () => (
            <div className="flex flex-col p-1">
                <div className={CAPTION_CLASS}>
                    {t("navigation.projectMenu.projectsIn", {organization: orgLabel})}
                </div>
                <EntryList entries={projects} close={close} />
                <div className="my-1 h-px bg-colorBorderSecondary" />
                <Row onClick={() => setPanel("orgs")}>
                    <ArrowsLeftRight size={14} className="shrink-0" />
                    <span className="flex-1">{t("navigation.projectMenu.switchOrganization")}</span>
                </Row>
                {onCreateProject && (
                    // A row like the rest: accent-yellow and bolder made a create action look
                    // like the panel's answer, when it is the least likely thing you came for.
                    <Row
                        onClick={() => {
                            close()
                            onCreateProject()
                        }}
                    >
                        <Plus size={14} className="shrink-0" />
                        <span className="flex-1">{t("navigation.projectMenu.newProject")}</span>
                    </Row>
                )}
                {theme && <ThemeFlyout theme={theme} />}
                {onLogout && (
                    <Row
                        className="!text-colorError"
                        onClick={() => {
                            close()
                            onLogout()
                        }}
                    >
                        <SignOut size={14} className="shrink-0" />
                        <span className="flex-1">{t("navigation.projectMenu.logout")}</span>
                    </Row>
                )}
            </div>
        ),
        [close, onCreateProject, onLogout, orgLabel, projects, t, theme],
    )

    const orgPanel = useMemo(
        () => (
            <div className="flex flex-col p-1">
                <div className="flex items-center justify-between">
                    <Row
                        className="!w-auto flex-1 font-medium"
                        onClick={() => setPanel("projects")}
                    >
                        <ArrowLeft size={14} className="shrink-0" />
                        <span>{t("navigation.projectMenu.projects")}</span>
                    </Row>
                    <button
                        type="button"
                        aria-label={t("common.close")}
                        title={t("common.close")}
                        onClick={close}
                        className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary hover:bg-colorFillTertiary"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className={CAPTION_CLASS}>{t("navigation.projectMenu.organizations")}</div>
                <EntryList entries={orgs} close={close} />
                <div className="my-1 h-px bg-colorBorderSecondary" />
                {onCreateOrg && (
                    <Row
                        onClick={() => {
                            close()
                            onCreateOrg()
                        }}
                    >
                        <Plus size={14} className="shrink-0" />
                        <span className="flex-1">
                            {t("navigation.projectMenu.createOrganization")}
                        </span>
                    </Row>
                )}
                {onOrgSettings && (
                    <Row
                        onClick={() => {
                            close()
                            onOrgSettings()
                        }}
                    >
                        <GearSix size={14} className="shrink-0" />
                        <span className="flex-1">
                            {t("navigation.projectMenu.organizationSettings")}
                        </span>
                    </Row>
                )}
                {theme && <ThemeFlyout theme={theme} />}
                {onLogout && (
                    <Row
                        className="!text-colorError"
                        onClick={() => {
                            close()
                            onLogout()
                        }}
                    >
                        <SignOut size={14} className="shrink-0" />
                        <span className="flex-1">{t("navigation.projectMenu.logout")}</span>
                    </Row>
                )}
            </div>
        ),
        [close, onCreateOrg, onLogout, onOrgSettings, orgs, t, theme],
    )

    return (
        <div
            className={clsx(
                // Same 300ms the rail itself uses (SidebarShell): without it this box jumps to its
                // collapsed geometry on the first frame while the rail is still sliding, and the
                // switcher reads as a separate, badly-timed element rather than part of the rail.
                "flex gap-1 px-2 transition-all duration-300",
                side === "bottom" ? "h-12 shrink-0" : "pb-1.5",
                // No top pad: the bottom nav already ends with its own spacing above the switcher.
                collapsed ? "flex-col items-center" : "w-full items-center",
            )}
        >
            {/* Collapsed, the rail is one icon wide: the trailing control stacks above the
                switcher instead of sitting beside it. */}
            {collapsed ? trailing : null}
            <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        data-project-org-switcher
                        className={clsx(
                            // Borderless at rest; the hover fill is the affordance. `transition-all`
                            // (not just colors) so the width/padding swap below travels with the
                            // rail rather than snapping ahead of it.
                            "flex cursor-pointer items-center rounded-md border-0 bg-transparent transition-all duration-300 hover:bg-colorFillTertiary",
                            // pl-2.5 tucks the wider avatar 2px left of the nav rows' icon column.
                            collapsed
                                ? "size-7 justify-center p-0"
                                : "h-8 min-w-0 flex-1 gap-[10px] pl-2.5 pr-1",
                        )}
                        title={`${projectLabel} · ${orgLabel}`}
                    >
                        <InitialsAvatar size="small" name={projectLabel} className="shrink-0" />
                        {/* One line, not two: the org already names itself on the panel's
                            caption, and stacking it here made the rail's shortest row its
                            tallest. */}
                        {!collapsed && (
                            <>
                                <span className="min-w-0 flex-1 truncate text-left text-[13px] leading-none text-colorText">
                                    {projectLabel}
                                </span>
                                {triggerMeta ? (
                                    <span className="shrink-0 text-[10px] leading-none text-colorTextTertiary">
                                        {triggerMeta}
                                    </span>
                                ) : null}
                                {side === "bottom" ? (
                                    <CaretDown
                                        size={12}
                                        className="shrink-0 text-colorTextSecondary"
                                    />
                                ) : (
                                    <CaretUpDown
                                        size={12}
                                        className="shrink-0 text-colorTextSecondary"
                                    />
                                )}
                            </>
                        )}
                    </button>
                </PopoverTrigger>
                {/* A popover, not a menu: the panels hold scrollable lists, and a Radix menu's
                    pointer handling swallows touch scrolling. Docked at the rail's bottom-left
                    edge: open upward, left-aligned, so the panel never clips the viewport's
                    left edge. Width matches the expanded trigger. */}
                <PopoverContent
                    container={panelContainer}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    side={side}
                    align="start"
                    className="z-[2000] w-[220px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgElevated p-0 shadow-md"
                >
                    {panel === "projects" ? projectPanel : orgPanel}
                </PopoverContent>
            </Popover>
            {collapsed ? null : trailing}
        </div>
    )
}
