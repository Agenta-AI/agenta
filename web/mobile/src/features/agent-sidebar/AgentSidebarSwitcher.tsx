import {useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {SidebarLayoutContext} from "@agenta/navigation-ui"
import {IconTile, SimpleTooltip} from "@agenta/ui/composed"
import {BottomSheet} from "@agenta/ui/phone"
import {cn, Input, MENU_ITEM, Popover, PopoverContent, PopoverTrigger, Spinner} from "@agenta/ui/ui"
import {CaretDownIcon, CheckIcon, PlusIcon, RobotIcon, SparkleIcon} from "@phosphor-icons/react"

import {SwitcherTile, type SwitcherTileSize} from "./SwitcherTile"

/** Above this many agents the panel gets a search field. */
const SEARCH_FROM = 8

export interface SwitcherAgent {
    id: string
    name?: string | null
    slug?: string | null
}

const agentName = (agent: SwitcherAgent | undefined) => agent?.name || agent?.slug || ""

/** What the switcher shows: one agent (the agent sidebar) or the builder (the builder sidebar). */
export type SwitcherCurrent = {kind: "agent"; agentId: string} | {kind: "builder"}

/** The builder's Mark in the switcher: the agent Mark's size, neutral. */
const BuilderTile = ({size}: {size: SwitcherTileSize}) => (
    <IconTile size={size}>
        <SparkleIcon />
    </IconTile>
)

/** Written durations come from the theme (MOTION-01). */
const COLOR_MOTION = "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]"

/** One row of the panel: a menu row (ROW-02), the current one selected and checked. */
const PanelRow = ({
    current = false,
    item = false,
    onClick,
    children,
    testId,
}: {
    current?: boolean
    /** A list entry, not an action: it keeps its height inside the scrolling list. */
    item?: boolean
    onClick: () => void
    children: ReactNode
    testId?: string
}) => (
    <button
        type="button"
        data-testid={testId}
        aria-current={current ? "true" : undefined}
        onClick={onClick}
        className={cn(
            MENU_ITEM,
            "focus-ring-inset border-0 bg-transparent text-left text-foreground [font-family:inherit] hover:bg-accent",
            item && "shrink-0",
            current && "bg-selected",
        )}
    >
        {children}
        {current ? <CheckIcon aria-hidden size={16} className="shrink-0 text-foreground" /> : null}
    </button>
)

/** The sidebar's agent switcher: a rail row, and a panel of menu rows (a bottom sheet on a phone). */
export const AgentSidebarSwitcher = ({
    agents,
    current,
    collapsed,
    projectName,
    onPick,
    onAllAgents,
    onNewAgent,
    creating = false,
    createError,
}: {
    agents: SwitcherAgent[]
    current: SwitcherCurrent
    collapsed: boolean
    /** The panel's caption, "Agents in <project>"; "Agents" until it loads. */
    projectName?: string
    onPick: (agentId: string) => void
    onAllAgents: () => void
    onNewAgent: () => void
    /** A "New agent" create is running; the panel stays open and says so. */
    creating?: boolean
    createError?: string | null
}) => {
    const t = useT(agentSidebarCatalog)
    const tBuilder = useT(builderPageCatalog)
    const phone = useContext(SidebarLayoutContext) === "phone"
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")
    const builder = current.kind === "builder"
    const agentId = current.kind === "agent" ? current.agentId : null
    const name = builder
        ? tBuilder("builder.page.builder")
        : agentName(agents.find((agent) => agent.id === agentId))

    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (!needle) return agents
        return agents.filter((agent) => agentName(agent).toLowerCase().includes(needle))
    }, [agents, search])

    const onOpenChange = (next: boolean) => {
        // A running create keeps the panel open, so its outcome stays in view.
        if (!next && creating) return
        if (!next) setSearch("")
        setOpen(next)
    }
    // A create that lands closes the panel; one that fails keeps it open with its error.
    const anchorRef = useRef<HTMLDivElement>(null)
    const wasCreating = useRef(creating)
    useEffect(() => {
        if (wasCreating.current && !creating && !createError) setOpen(false)
        wasCreating.current = creating
    }, [createError, creating])
    // While a create runs, its hand-off decides where you land; other picks wait.
    const run = (action: () => void) => () => {
        if (creating) return
        onOpenChange(false)
        action()
    }

    const caption = projectName
        ? t("agentSidebar.agentsIn", {project: projectName})
        : t("agentSidebar.agents")

    const panel = (
        <div className="flex flex-col p-1">
            {!builder && agents.length > SEARCH_FROM ? (
                <Input
                    autoFocus
                    size="sm"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("agentSidebar.searchAgents")}
                    aria-label={t("agentSidebar.searchAgents")}
                    className="mb-1"
                />
            ) : null}
            {builder ? (
                <>
                    <PanelRow
                        current
                        onClick={() => onOpenChange(false)}
                        testId="agent-sidebar-switcher-builder"
                    >
                        <BuilderTile size={20} />
                        <span className="min-w-0 flex-1 truncate">
                            {tBuilder("builder.page.builder")}
                        </span>
                    </PanelRow>
                    <div className="my-1 h-px bg-border-muted" />
                </>
            ) : null}
            {phone ? null : (
                <div className="truncate px-2 pb-1 pt-1.5 text-meta text-muted-foreground">
                    {caption}
                </div>
            )}
            <div className="ag-scroll-quiet flex max-h-56 flex-col overflow-y-auto">
                {shown.map((agent) => (
                    <PanelRow
                        key={agent.id}
                        item
                        current={agent.id === agentId}
                        onClick={run(() => {
                            if (agent.id !== agentId) onPick(agent.id)
                        })}
                    >
                        <SwitcherTile agentId={agent.id} size={20} />
                        <span className="min-w-0 flex-1 truncate">{agentName(agent)}</span>
                    </PanelRow>
                ))}
            </div>
            <div className="my-1 h-px bg-border-muted" />
            <div className="flex flex-col">
                <PanelRow onClick={run(onAllAgents)}>
                    <span className="flex size-5 shrink-0 items-center justify-center">
                        <RobotIcon aria-hidden size={16} />
                    </span>
                    <span className="flex-1">{t("agentSidebar.allAgents")}</span>
                </PanelRow>
                <PanelRow onClick={() => !creating && onNewAgent()}>
                    <span className="flex size-5 shrink-0 items-center justify-center">
                        {creating ? <Spinner size="small" /> : <PlusIcon aria-hidden size={16} />}
                    </span>
                    <span className="flex-1">
                        {creating ? t("agentSidebar.creatingAgent") : t("agentSidebar.newAgent")}
                    </span>
                </PanelRow>
                {createError ? (
                    <p role="alert" className="m-0 px-2 pb-1 text-meta text-destructive">
                        {createError}
                    </p>
                ) : null}
            </div>
        </div>
    )

    // One rail row (ALIGN-02): a 16px Mark on the icon line, one label line, a turning caret.
    const trigger = (
        <button
            type="button"
            aria-label={name || t("agentSidebar.agent")}
            data-testid="agent-sidebar-switcher"
            className={cn(
                "focus-ring flex h-row-dense cursor-pointer items-center rounded-md border-0 bg-transparent p-0 text-foreground [font-family:inherit] hover:bg-accent data-[state=open]:bg-accent",
                COLOR_MOTION,
                collapsed ? "w-row-dense justify-center" : "w-full min-w-0 gap-2 px-2 text-left",
            )}
        >
            {agentId ? <SwitcherTile agentId={agentId} size={16} /> : <BuilderTile size={16} />}
            {collapsed ? null : (
                <>
                    <span className="min-w-0 flex-1 truncate text-label">{name}</span>
                    <CaretDownIcon
                        aria-hidden
                        size={12}
                        className="ag-caret shrink-0 text-muted-foreground"
                    />
                </>
            )}
        </button>
    )

    if (phone)
        return (
            <div className="flex w-full min-w-0">
                <BottomSheet
                    open={open}
                    onOpenChange={onOpenChange}
                    title={caption}
                    trigger={trigger}
                    hideClose
                    data-testid="agent-sidebar-switcher-sheet"
                >
                    {panel}
                </BottomSheet>
            </div>
        )

    return (
        <div ref={anchorRef} className={collapsed ? "flex justify-center" : "flex w-full min-w-0"}>
            <Popover open={open} onOpenChange={onOpenChange} modal={false}>
                {collapsed ? (
                    <SimpleTooltip title={name} side="right">
                        <span className="inline-flex">
                            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                        </span>
                    </SimpleTooltip>
                ) : (
                    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                )}
                <PopoverContent
                    // Inside the tablet drawer the panel portals into the sheet, or its scroll lock
                    // blocks the list's scroll.
                    container={anchorRef.current?.closest<HTMLElement>(
                        '[data-slot="sheet-content"]',
                    )}
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    // Expanded, the panel spans the switcher row.
                    className={cn(
                        "w-popover-sm p-0",
                        !collapsed && "!w-[var(--radix-popover-trigger-width)]",
                    )}
                >
                    {panel}
                </PopoverContent>
            </Popover>
        </div>
    )
}
