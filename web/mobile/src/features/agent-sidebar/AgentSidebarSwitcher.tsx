import {useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

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
import {Popover, PopoverContent, PopoverTrigger, Spinner} from "@agenta/ui/ui"
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
        className={`flex shrink-0 items-center justify-center bg-colorSplit text-foreground ${SWITCHER_TILE[size].box}`}
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
        {current ? <CheckIcon aria-hidden size={14} className="shrink-0 text-foreground" /> : null}
    </button>
)

/** The sidebar's agent switcher: a boxed row, and a panel in the project switcher's look. */
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
    const anchorRef = useRef<HTMLDivElement>(null)
    const builder = current.kind === "builder"
    const agentId = current.kind === "agent" ? current.agentId : null
    const name = builder
        ? tBuilder("builder.page.builder")
        : agentName(agents.find((agent) => agent.id === agentId))
    const tileSize: SwitcherTileSize = collapsed ? "md" : "sm"

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
                                ? "flex size-7 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 [font-family:inherit] hover:bg-colorFillTertiary"
                                : "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[6px] border border-solid border-colorBorderSecondary bg-transparent pl-2.5 pr-3 text-left text-foreground transition-colors [font-family:inherit] hover:bg-colorFillTertiary data-[state=open]:bg-colorFillTertiary"
                        }
                    >
                        {agentId ? (
                            <SwitcherTile agentId={agentId} size={tileSize} />
                        ) : (
                            <BuilderTile size={tileSize} />
                        )}
                        {collapsed ? null : (
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
                    // Inside the phone sheet, or the sheet's scroll lock blocks the list's scroll.
                    container={anchorRef.current?.closest<HTMLElement>(
                        '[data-slot="sheet-content"]',
                    )}
                    // Expanded, the panel spans the switcher row, as the project panel spans the header.
                    className={`${SWITCHER_PANEL_CLASS} ${collapsed ? "" : "!w-[var(--radix-popover-trigger-width)]"}`}
                >
                    <div className="flex flex-col p-1">
                        {builder ? (
                            <>
                                <PanelRow
                                    current
                                    onClick={() => onOpenChange(false)}
                                    testId="agent-sidebar-switcher-builder"
                                >
                                    <BuilderTile size="md" />
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
                                className="mx-1 mb-1 h-8 w-[calc(100%-8px)] rounded-md border border-solid border-border bg-transparent px-2 text-sm text-foreground outline-none [font-family:inherit] focus:border-primary"
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
                                    <SwitcherTile agentId={agent.id} size="md" />
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
                            <PanelRow onClick={() => !creating && onNewAgent()}>
                                <span className="flex size-6 shrink-0 items-center justify-center">
                                    {creating ? (
                                        <Spinner size="small" />
                                    ) : (
                                        <PlusIcon aria-hidden size={14} />
                                    )}
                                </span>
                                <span className="flex-1">
                                    {creating
                                        ? t("agentSidebar.creatingAgent")
                                        : t("agentSidebar.newAgent")}
                                </span>
                            </PanelRow>
                            {createError ? (
                                <p className="m-0 px-2 pb-1 text-[12px] text-destructive">
                                    {createError}
                                </p>
                            ) : null}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
}
