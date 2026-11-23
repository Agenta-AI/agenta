import {useContext, useMemo, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {
    SidebarLayoutContext,
    SWITCHER_CAPTION_CLASS,
    SWITCHER_ITEM_ROW_CLASS,
    SWITCHER_PANEL_CLASS,
    SWITCHER_ROW_CLASS,
} from "@agenta/navigation-ui"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretUpDownIcon, CheckIcon, PlusIcon, RobotIcon, SparkleIcon} from "@phosphor-icons/react"

import {SWITCHER_TILE, SwitcherTile, type SwitcherTileSize} from "./SwitcherTile"

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

/** The builder's tile in the switcher: the agent tile's size, on the neutral fill. */
const BuilderTile = ({size}: {size: SwitcherTileSize}) => (
    <span
        className={`flex shrink-0 items-center justify-center bg-colorSplit text-colorText ${SWITCHER_TILE[size].box}`}
    >
        <SparkleIcon size={SWITCHER_TILE[size].glyph} />
    </span>
)

/** One row of the panel, as the project switcher draws it: the current one filled and checked. */
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
        className={`${SWITCHER_ROW_CLASS} ${item ? SWITCHER_ITEM_ROW_CLASS : ""} ${current ? "bg-colorFillSecondary" : ""}`}
    >
        {children}
        {current ? <CheckIcon aria-hidden size={14} className="shrink-0 text-colorText" /> : null}
    </button>
)

/**
 * The sidebar switcher: a boxed row with the agent's tile and name, and, in the project
 * switcher's look, a panel with the project's agents, the current one checked, then "All agents"
 * and "New agent". The builder sidebar's panel starts with "Builder". What a pick opens is the
 * host's.
 */
export const AgentSidebarSwitcher = ({
    agents,
    current,
    collapsed,
    projectName,
    onPick,
    onPickBuilder,
    onAllAgents,
    onNewAgent,
}: {
    agents: SwitcherAgent[]
    current: SwitcherCurrent
    collapsed: boolean
    /** The panel's caption, "Agents in <project>"; "Agents" until it loads. */
    projectName?: string
    onPick: (agentId: string) => void
    /** "Builder" in the builder sidebar's panel. */
    onPickBuilder: () => void
    onAllAgents: () => void
    onNewAgent: () => void
}) => {
    const t = useT(agentSidebarCatalog)
    const tBuilder = useT(builderPageCatalog)
    const phone = useContext(SidebarLayoutContext) === "phone"
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")
    const [panelWidth, setPanelWidth] = useState<number>()
    const anchorRef = useRef<HTMLDivElement>(null)
    const builder = current.kind === "builder"
    const agentId = current.kind === "agent" ? current.agentId : null
    const name = builder
        ? tBuilder("builder.page.builder")
        : agentName(agents.find((agent) => agent.id === agentId))
    const tileSize: SwitcherTileSize = collapsed ? "rail" : phone ? "phone" : "row"

    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (!needle) return agents
        return agents.filter((agent) => agentName(agent).toLowerCase().includes(needle))
    }, [agents, search])

    const onOpenChange = (next: boolean) => {
        // In the rail the panel spans the switcher's row, as the project panel spans the header.
        if (next && !collapsed && anchorRef.current) setPanelWidth(anchorRef.current.offsetWidth)
        if (!next) setSearch("")
        setOpen(next)
    }
    const run = (action: () => void) => () => {
        onOpenChange(false)
        action()
    }

    return (
        <div ref={anchorRef} className={collapsed ? "flex justify-center" : "flex w-full min-w-0"}>
            <Popover open={open} onOpenChange={onOpenChange} modal={false}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={name || t("agentSidebar.agent")}
                        title={collapsed ? name : undefined}
                        data-testid="agent-sidebar-switcher"
                        className={
                            collapsed
                                ? "flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 [font-family:inherit] hover:bg-colorFillTertiary"
                                : phone
                                  ? "flex h-[52px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-colorText [font-family:inherit] hover:bg-colorFillTertiary"
                                  : "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent pl-2.5 pr-3 text-left text-colorText shadow-[inset_0_0_0_1px_var(--ag-shell-line)] [font-family:inherit] hover:shadow-[inset_0_0_0_1px_var(--border)] data-[state=open]:bg-colorFillTertiary data-[state=open]:shadow-[inset_0_0_0_1px_var(--border)]"
                        }
                    >
                        {agentId ? (
                            <SwitcherTile agentId={agentId} size={tileSize} />
                        ) : (
                            <BuilderTile size={tileSize} />
                        )}
                        {collapsed ? null : phone ? (
                            <>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px] font-medium leading-5">
                                        {name}
                                    </span>
                                    {builder ? null : (
                                        <span className="text-[12px] leading-4 text-colorTextSecondary">
                                            {t("agentSidebar.agent")}
                                        </span>
                                    )}
                                </span>
                                <CaretUpDownIcon
                                    size={14}
                                    className="shrink-0 text-colorTextTertiary"
                                />
                            </>
                        ) : (
                            <>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5">
                                    {name}
                                </span>
                                <CaretUpDownIcon
                                    size={12}
                                    className="shrink-0 text-colorTextTertiary"
                                />
                            </>
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    style={panelWidth ? {width: panelWidth} : undefined}
                    className={SWITCHER_PANEL_CLASS}
                >
                    <div className="flex flex-col p-1">
                        {builder ? (
                            <>
                                <PanelRow
                                    current
                                    onClick={run(onPickBuilder)}
                                    testId="agent-sidebar-switcher-builder"
                                >
                                    <BuilderTile size="panel" />
                                    <span className="min-w-0 flex-1 truncate">
                                        {tBuilder("builder.page.builder")}
                                    </span>
                                </PanelRow>
                                <div className="my-1 h-px bg-colorBorderSecondary" />
                            </>
                        ) : null}
                        <div className={SWITCHER_CAPTION_CLASS}>
                            {projectName
                                ? t("agentSidebar.agentsIn", {project: projectName})
                                : t("agentSidebar.agents")}
                        </div>
                        {!builder && agents.length > SEARCH_FROM ? (
                            <input
                                autoFocus
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder={t("agentSidebar.searchAgents")}
                                aria-label={t("agentSidebar.searchAgents")}
                                className="mx-1 mb-1 h-8 w-[calc(100%-8px)] rounded-md border border-solid border-colorBorder bg-transparent px-2 text-sm text-colorText outline-none [font-family:inherit] focus:border-colorPrimary"
                            />
                        ) : null}
                        <div className="ag-scroll-quiet flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                            {shown.map((agent) => (
                                <PanelRow
                                    key={agent.id}
                                    item
                                    current={agent.id === agentId}
                                    onClick={run(() => {
                                        if (agent.id !== agentId) onPick(agent.id)
                                    })}
                                >
                                    <SwitcherTile agentId={agent.id} size="panel" />
                                    <span className="min-w-0 flex-1 truncate">
                                        {agentName(agent)}
                                    </span>
                                </PanelRow>
                            ))}
                        </div>
                        <div className="my-1 h-px bg-colorBorderSecondary" />
                        <div className="flex flex-col gap-0.5">
                            <PanelRow onClick={run(onAllAgents)}>
                                <span className="flex size-6 shrink-0 items-center justify-center">
                                    <RobotIcon aria-hidden size={14} />
                                </span>
                                <span className="flex-1">{t("agentSidebar.allAgents")}</span>
                            </PanelRow>
                            <PanelRow onClick={run(onNewAgent)}>
                                <span className="flex size-6 shrink-0 items-center justify-center">
                                    <PlusIcon aria-hidden size={14} />
                                </span>
                                <span className="flex-1">{t("agentSidebar.newAgent")}</span>
                            </PanelRow>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
}
