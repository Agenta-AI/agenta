import {useCallback, useMemo, useState, type ReactNode} from "react"

import {InitialsAvatar} from "@agenta/ui/components/presentational"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {
    ArrowLeft,
    ArrowsLeftRight,
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
    /** Wording for the second panel — "organization" on desktop, "workspace" on mobile. */
    orgNoun?: string
    /** Where the panel portals. A drawer passes an element INSIDE its sheet: a modal sheet's
     * scroll lock blocks scrolling in portals outside its subtree. */
    panelContainer?: HTMLElement | null
    /** Theme fly-out row above logout — omit and no theme control renders. */
    theme?: SwitcherThemeControl
    /** Optional rows — absent handlers render nothing, so a shell offers what it supports. */
    onCreateProject?: () => void
    onCreateOrg?: () => void
    onOrgSettings?: () => void
    onLogout?: () => void
}

type Panel = "projects" | "orgs"

const ROW_CLASS =
    "flex w-full items-center gap-2 h-8 px-2 rounded-md text-sm leading-none text-left cursor-pointer border-0 bg-transparent [font-family:inherit] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-colorPrimary text-colorText hover:bg-colorFillTertiary transition-colors"

/** shrink-0 stops the capped scroll list from compressing rows instead of scrolling. */
const ITEM_ROW_CLASS = "shrink-0"

const CAPTION_CLASS = "px-2 pt-1.5 pb-1 text-xs font-medium text-colorTextTertiary truncate"

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
    const current = theme.options.find(({mode}) => mode === theme.mode) ?? theme.options[0]
    if (!current) return null
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className={ROW_CLASS}>
                    {current.icon}
                    <span className="flex-1">Theme</span>
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

const EntryList = ({entries, close}: {entries: SwitcherEntry[]; close: () => void}) => (
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
 * The rail's project/org switcher, ported from the OSS design: a two-panel popup (projects,
 * then organizations behind "Switch organization") docked at the trigger. Data and actions
 * arrive as props — the desktop binds its org state, the mobile drawer its workspaces.
 */
export const ProjectOrgSwitcherView = ({
    collapsed,
    projectLabel,
    orgLabel,
    projects,
    orgs,
    orgNoun = "organization",
    panelContainer,
    theme,
    onCreateProject,
    onCreateOrg,
    onOrgSettings,
    onLogout,
}: ProjectOrgSwitcherViewProps) => {
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

    const capitalizedNoun = orgNoun.charAt(0).toUpperCase() + orgNoun.slice(1)

    const projectPanel = useMemo(
        () => (
            <div className="flex flex-col p-1">
                <div className={CAPTION_CLASS}>Projects in {orgLabel}</div>
                <EntryList entries={projects} close={close} />
                <div className="my-1 h-px bg-colorBorderSecondary" />
                <Row onClick={() => setPanel("orgs")}>
                    <ArrowsLeftRight size={14} className="shrink-0" />
                    <span className="flex-1">Switch {orgNoun}</span>
                </Row>
                {onCreateProject && (
                    <Row
                        className="font-medium !text-colorPrimary"
                        onClick={() => {
                            close()
                            onCreateProject()
                        }}
                    >
                        <Plus size={14} className="shrink-0" />
                        <span className="flex-1">New project</span>
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
                        <span className="flex-1">Logout</span>
                    </Row>
                )}
            </div>
        ),
        [close, onCreateProject, onLogout, orgLabel, orgNoun, projects, theme],
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
                        <span>Projects</span>
                    </Row>
                    <button
                        type="button"
                        aria-label="Close"
                        title="Close"
                        onClick={close}
                        className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary hover:bg-colorFillTertiary"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className={CAPTION_CLASS}>{capitalizedNoun}s</div>
                <EntryList entries={orgs} close={close} />
                <div className="my-1 h-px bg-colorBorderSecondary" />
                {onCreateOrg && (
                    <Row
                        className="font-medium !text-colorPrimary"
                        onClick={() => {
                            close()
                            onCreateOrg()
                        }}
                    >
                        <Plus size={14} className="shrink-0" />
                        <span className="flex-1">Create {orgNoun}</span>
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
                        <span className="flex-1">{capitalizedNoun} settings</span>
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
                        <span className="flex-1">Logout</span>
                    </Row>
                )}
            </div>
        ),
        [capitalizedNoun, close, onCreateOrg, onLogout, onOrgSettings, orgNoun, orgs, theme],
    )

    return (
        <div
            className={clsx(
                // Same 300ms the rail itself uses (SidebarShell): without it this box jumps to its
                // collapsed geometry on the first frame while the rail is still sliding, and the
                // switcher reads as a separate, badly-timed element rather than part of the rail.
                "px-2 py-2 transition-all duration-300",
                collapsed && "flex justify-center",
            )}
        >
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
                            // px-3 puts the avatar on the nav rows' icon column instead of 6px inside it.
                            collapsed ? "h-8 w-8 justify-center p-1" : "w-full gap-2 px-3 py-1.5",
                        )}
                        title={`${projectLabel} · ${orgLabel}`}
                    >
                        <InitialsAvatar size="small" name={projectLabel} className="shrink-0" />
                        {!collapsed && (
                            <>
                                <div className="flex min-w-0 flex-1 flex-col text-left">
                                    <span className="truncate text-sm font-medium leading-tight text-colorText">
                                        {projectLabel}
                                    </span>
                                    <span className="truncate text-xs leading-tight text-colorTextSecondary">
                                        {orgLabel}
                                    </span>
                                </div>
                                <CaretUpDown
                                    size={14}
                                    className="shrink-0 text-colorTextSecondary"
                                />
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
                    side="top"
                    align="start"
                    className="z-[2000] w-[220px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgElevated p-0 shadow-md"
                >
                    {panel === "projects" ? projectPanel : orgPanel}
                </PopoverContent>
            </Popover>
        </div>
    )
}
