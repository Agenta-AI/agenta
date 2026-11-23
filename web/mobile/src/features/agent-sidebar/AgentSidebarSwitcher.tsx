import {useContext, useMemo, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {SidebarLayoutContext} from "@agenta/navigation-ui"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretUpDownIcon, CheckIcon, PlusIcon} from "@phosphor-icons/react"
import {Bot} from "lucide-react"

import {SWITCHER_TILE, SwitcherTile, type SwitcherTileSize} from "./SwitcherTile"

/** Above this many agents the menu gets a search field. */
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
        <BuilderIcon size={SWITCHER_TILE[size].glyph} />
    </span>
)

/** One row of the switcher menu. The current one is in medium weight with a check at the end. */
const SwitcherMenuItem = ({
    current = false,
    tile,
    label,
    onSelect,
    testId,
}: {
    current?: boolean
    tile: ReactNode
    label: string
    onSelect: () => void
    testId?: string
}) => (
    <DropdownMenuItem
        data-testid={testId}
        aria-current={current ? "true" : undefined}
        // The current one stays where it is: picking it changes nothing.
        onSelect={current ? undefined : onSelect}
        className={current ? "bg-colorFillTertiary font-medium" : undefined}
    >
        {tile}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {current ? <CheckIcon aria-hidden size={14} className="shrink-0 text-colorText" /> : null}
    </DropdownMenuItem>
)

/**
 * The sidebar switcher: the sidebar's agent (or the builder) as a row shaped like the project
 * switcher, and a menu with the project's agents, the current one checked, then "All agents" and
 * "New agent". The builder sidebar's menu starts with "Builder". What a pick opens is the host's.
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
    /** The menu's caption, "Agents in <project>"; "Agents" until it loads. */
    projectName?: string
    onPick: (agentId: string) => void
    /** "Builder" in the builder sidebar's menu. */
    onPickBuilder: () => void
    onAllAgents: () => void
    onNewAgent: () => void
}) => {
    const t = useT(agentSidebarCatalog)
    const tBuilder = useT(builderPageCatalog)
    const phone = useContext(SidebarLayoutContext) === "phone"
    const [search, setSearch] = useState("")
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

    return (
        <DropdownMenu onOpenChange={(open) => !open && setSearch("")}>
            <DropdownMenuTrigger asChild>
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
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[420px] w-[222px] overflow-y-auto">
                {builder ? (
                    <>
                        <SwitcherMenuItem
                            current
                            tile={<BuilderTile size="row" />}
                            label={tBuilder("builder.page.builder")}
                            onSelect={onPickBuilder}
                            testId="agent-sidebar-switcher-builder"
                        />
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                <div className="truncate px-2 pb-1 pt-1.5 text-xs text-colorTextSecondary">
                    {projectName
                        ? t("agentSidebar.agentsIn", {project: projectName})
                        : t("agentSidebar.agents")}
                </div>
                {!builder && agents.length > SEARCH_FROM ? (
                    <input
                        // Typing must reach the field, not the menu's type-ahead. ArrowDown moves
                        // into the results; Escape still closes the menu.
                        onKeyDown={(event) => {
                            if (event.key === "Escape") return
                            event.stopPropagation()
                            if (event.key !== "ArrowDown") return
                            event.preventDefault()
                            event.currentTarget
                                .closest('[role="menu"]')
                                ?.querySelector<HTMLElement>(
                                    '[role="menuitem"]:not([data-disabled])',
                                )
                                ?.focus()
                        }}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("agentSidebar.searchAgents")}
                        aria-label={t("agentSidebar.searchAgents")}
                        className="mx-1 mb-1 h-8 w-[calc(100%-8px)] rounded-md border border-solid border-colorBorder bg-transparent px-2 text-sm text-colorText outline-none [font-family:inherit] focus:border-colorPrimary"
                    />
                ) : null}
                {shown.map((agent) => (
                    <SwitcherMenuItem
                        key={agent.id}
                        current={agent.id === agentId}
                        tile={<SwitcherTile agentId={agent.id} size="row" />}
                        label={agentName(agent)}
                        onSelect={() => onPick(agent.id)}
                    />
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onAllAgents}>
                    <Bot aria-hidden size={14} className="shrink-0" />
                    <span className="flex-1">{t("agentSidebar.allAgents")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onNewAgent}>
                    <PlusIcon aria-hidden size={14} className="shrink-0" />
                    <span className="flex-1">{t("agentSidebar.newAgent")}</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
