import {useCallback, useMemo, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {
    Button,
    IconTile,
    MENU_ITEM,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SimpleTooltip,
    cn,
} from "@agenta/ui/ui"
import {
    ArrowLeft,
    ArrowsLeftRight,
    CaretDown,
    CaretRight,
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
    /** The header's compact trigger, with the panel as wide as the rail. On by default for "bottom". */
    compact?: boolean
    /** Quiet text inside the expanded trigger, before the caret (the app version). */
    triggerMeta?: ReactNode
    /** Optional rows — absent handlers render nothing, so a shell offers what it supports. */
    onCreateProject?: () => void
    onCreateOrg?: () => void
    onOrgSettings?: () => void
    onLogout?: () => void
}

type Panel = "projects" | "orgs"

/** A menu row (ROW-02) on a plain button: hover takes the fill a Radix item gets on highlight. */
export const ROW_CLASS = cn(
    MENU_ITEM,
    "border-0 bg-transparent text-left text-foreground [font-family:inherit] transition-colors hover:bg-accent focus-ring-inset",
)

/** shrink-0 stops the capped scroll list from compressing rows instead of scrolling. */
export const ITEM_ROW_CLASS = "shrink-0"

export const CAPTION_CLASS = "truncate px-2 py-1.5 text-meta font-medium text-muted-foreground"

/** The switcher panel's surface; the agent switcher wears it too. */
export const PANEL_CLASS = "w-popover-sm overflow-hidden p-0"

/** The current entry's check: the kit menus' 14px check. */
const CHECK_CLASS = "size-4 shrink-0 text-foreground"

/** The rule between the lists and the actions, as the kit menus draw it. */
const Divider = () => <div className="my-1 h-px shrink-0 bg-border-muted" />

/** A one-letter Mark (16px in menus and nav); the current one takes the brand tint. */
/** One soft data colour per first letter, so a project or an organization keeps its colour. */
const MARK_TINTS = [
    "bg-data-1/15 text-data-1",
    "bg-data-2/15 text-data-2",
    "bg-data-3/15 text-data-3",
    "bg-data-4/15 text-data-4",
    "bg-data-5/15 text-data-5",
    "bg-data-6/15 text-data-6",
] as const

const EntryMark = ({name}: {name: string}) => {
    const letter = name.trim().charAt(0).toUpperCase() || "?"
    const tint = MARK_TINTS[letter.charCodeAt(0) % MARK_TINTS.length]
    return (
        <IconTile size={20} className={clsx("shrink-0", tint)}>
            {letter}
        </IconTile>
    )
}

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
const ThemeFlyout = ({
    theme,
    container,
}: {
    theme: SwitcherThemeControl
    container?: HTMLElement | null
}) => {
    const t = useT(navigationCatalog)
    const current = theme.options.find(({mode}) => mode === theme.mode) ?? theme.options[0]
    if (!current) return null
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className={ROW_CLASS}>
                    {current.icon}
                    <span className="flex-1">{t("navigation.projectMenu.theme")}</span>
                    <span className="text-muted-foreground">{current.short}</span>
                    <CaretRight className="shrink-0 text-muted-foreground" />
                </button>
            </PopoverTrigger>
            {/* Same portal as the switcher: a body portal sits outside a drawer's focus trap,
                so the keyboard could not reach the options. */}
            <PopoverContent
                container={container}
                side="right"
                align="end"
                className="w-popover-sm p-1"
            >
                {theme.options.map(({mode, label, icon}) => (
                    <Row key={mode} className={ITEM_ROW_CLASS} onClick={() => theme.onSelect(mode)}>
                        {icon}
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {theme.mode === mode && <Check className={CHECK_CLASS} />}
                    </Row>
                ))}
            </PopoverContent>
        </Popover>
    )
}

export const EntryList = ({entries, close}: {entries: SwitcherEntry[]; close: () => void}) => (
    // Cap the list at about 7 item rows so the actions below it stay on screen.
    <div className="ag-scroll-quiet flex max-h-56 flex-col overflow-y-auto">
        {entries.map((entry) => (
            <Row
                key={entry.key}
                className={clsx(
                    ITEM_ROW_CLASS,
                    // scroll-initial-target is Chromium-only; elsewhere the list opens at the top.
                    // The check shows the current entry, as in the kit menus.
                    entry.isActive && "[scroll-initial-target:nearest]",
                )}
                onClick={() => {
                    close()
                    if (!entry.isActive) entry.onSelect()
                }}
            >
                <EntryMark name={entry.name} />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.isActive && <Check className={CHECK_CLASS} />}
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
    panelContainer,
    theme,
    trailing,
    side = "top",
    compact: compactProp,
    triggerMeta,
    onCreateProject,
    onCreateOrg,
    onOrgSettings,
    onLogout,
}: ProjectOrgSwitcherViewProps) => {
    const t = useT(navigationCatalog, commonCatalog)
    const compact = compactProp ?? side === "bottom"
    const [open, setOpen] = useState(false)
    const [panel, setPanel] = useState<Panel>("projects")
    const rowRef = useRef<HTMLDivElement>(null)
    const [headerWidth, setHeaderWidth] = useState<number>()

    const handleOpenChange = useCallback(
        (next: boolean) => {
            // In the header the panel spans the rail, 8px in from each side, as the trigger is.
            if (next && compact && !collapsed && rowRef.current)
                setHeaderWidth(rowRef.current.offsetWidth - 16)
            setOpen(next)
            if (!next) setPanel("projects")
        },
        [collapsed, compact],
    )

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
                <Divider />
                <Row onClick={() => setPanel("orgs")}>
                    <ArrowsLeftRight className="shrink-0" />
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
                        <Plus className="shrink-0" />
                        <span className="flex-1">{t("navigation.projectMenu.newProject")}</span>
                    </Row>
                )}
                {theme && <ThemeFlyout theme={theme} container={panelContainer} />}
                {onLogout && (
                    <>
                        <Divider />
                        <Row
                            onClick={() => {
                                close()
                                onLogout()
                            }}
                        >
                            <SignOut className="shrink-0" />
                            <span className="flex-1">{t("navigation.projectMenu.logout")}</span>
                        </Row>
                    </>
                )}
            </div>
        ),
        [close, onCreateProject, onLogout, orgLabel, panelContainer, projects, t, theme],
    )

    const orgPanel = useMemo(
        () => (
            <div className="flex flex-col p-1">
                <div className="flex items-center justify-between">
                    <Row className="!w-auto min-w-0 flex-1" onClick={() => setPanel("projects")}>
                        <ArrowLeft className="shrink-0" />
                        <span>{t("navigation.projectMenu.projects")}</span>
                    </Row>
                    <SimpleTooltip title={t("common.close")}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("common.close")}
                            onClick={close}
                            className="shrink-0 text-muted-foreground"
                        >
                            <X />
                        </Button>
                    </SimpleTooltip>
                </div>
                <div className={CAPTION_CLASS}>{t("navigation.projectMenu.organizations")}</div>
                <EntryList entries={orgs} close={close} />
                <Divider />
                {onCreateOrg && (
                    <Row
                        onClick={() => {
                            close()
                            onCreateOrg()
                        }}
                    >
                        <Plus className="shrink-0" />
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
                        <GearSix className="shrink-0" />
                        <span className="flex-1">
                            {t("navigation.projectMenu.organizationSettings")}
                        </span>
                    </Row>
                )}
                {theme && <ThemeFlyout theme={theme} container={panelContainer} />}
                {onLogout && (
                    <>
                        <Divider />
                        <Row
                            onClick={() => {
                                close()
                                onLogout()
                            }}
                        >
                            <SignOut className="shrink-0" />
                            <span className="flex-1">{t("navigation.projectMenu.logout")}</span>
                        </Row>
                    </>
                )}
            </div>
        ),
        [close, onCreateOrg, onLogout, onOrgSettings, orgs, panelContainer, t, theme],
    )

    const trigger = (
        <PopoverTrigger asChild>
            <button
                type="button"
                data-project-org-switcher
                className={clsx(
                    // Borderless at rest; the hover fill is the affordance.
                    "flex h-row-dense cursor-pointer items-center rounded-md border-0 bg-transparent transition-colors hover:bg-accent focus-ring",
                    // px-2 puts the Mark on the nav icons' column and the name on their text line.
                    collapsed
                        ? "w-row-dense justify-center p-0"
                        : clsx("min-w-0 gap-2 px-2", !compact && "flex-1"),
                )}
                title={collapsed ? undefined : `${projectLabel} · ${orgLabel}`}
            >
                <EntryMark name={projectLabel} />
                {/* One line: the org names itself on the panel's caption. */}
                {!collapsed && (
                    <>
                        <span
                            className={clsx(
                                "min-w-0 truncate text-left text-body text-foreground",
                                !compact && "flex-1",
                            )}
                        >
                            {projectLabel}
                        </span>
                        {triggerMeta ? (
                            <span className="shrink-0 text-caption leading-none text-muted-foreground">
                                {triggerMeta}
                            </span>
                        ) : null}
                        <CaretDown className="ag-caret size-3.5 shrink-0 text-muted-foreground" />
                    </>
                )}
            </button>
        </PopoverTrigger>
    )

    return (
        <div
            ref={rowRef}
            className={clsx(
                "flex gap-1 px-2",
                side === "bottom" ? "h-12 shrink-0" : "pb-1.5",
                compact && "justify-between",
                collapsed ? "flex-col items-center" : "w-full items-center",
            )}
        >
            {/* Collapsed, the rail is one icon wide: the trailing control stacks above the
                switcher instead of sitting beside it. */}
            {collapsed ? trailing : null}
            <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
                {collapsed ? (
                    // The span takes the tooltip, so two asChild triggers do not share one element.
                    <SimpleTooltip title={`${projectLabel} · ${orgLabel}`} side="right">
                        <span className="inline-flex">{trigger}</span>
                    </SimpleTooltip>
                ) : (
                    trigger
                )}
                {/* A popover, not a menu: a Radix menu swallows touch scrolling of its lists. */}
                <PopoverContent
                    container={panelContainer}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    side={side}
                    align="start"
                    sideOffset={side === "bottom" ? 4 : undefined}
                    style={compact && !collapsed ? {width: headerWidth} : undefined}
                    className={PANEL_CLASS}
                >
                    {panel === "projects" ? projectPanel : orgPanel}
                </PopoverContent>
            </Popover>
            {collapsed ? null : trailing}
        </div>
    )
}
