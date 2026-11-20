import {useContext, useMemo, useState} from "react"

import {AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {SidebarLayoutContext} from "@agenta/navigation-ui"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretUpDownIcon, CheckIcon} from "@phosphor-icons/react"

import {SwitcherTile} from "./SwitcherTile"

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
const BuilderTile = () => (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-colorSplit text-colorText">
        <BuilderIcon size={18} />
    </span>
)

/**
 * The sidebar switcher: the sidebar's agent (or the builder), and a menu with every agent the
 * person can see. In the builder sidebar the menu starts with "Builder", checked, and has no
 * search field. What a pick opens is the host's (`onPick`).
 */
export const AgentSidebarSwitcher = ({
    agents,
    current,
    collapsed,
    onPick,
}: {
    agents: SwitcherAgent[]
    current: SwitcherCurrent
    collapsed: boolean
    onPick: (agentId: string) => void
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
                    data-testid="agent-sidebar-switcher"
                    className={
                        collapsed
                            ? "flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 [font-family:inherit] hover:bg-colorFillTertiary"
                            : `flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent text-left text-colorText [font-family:inherit] hover:bg-colorFillTertiary ${phone ? "h-[52px] px-2" : "h-[38px] px-1.5"}`
                    }
                >
                    {agentId ? <SwitcherTile agentId={agentId} /> : <BuilderTile />}
                    {collapsed ? null : (
                        <>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span
                                    className={`truncate ${phone ? "text-[15px] font-medium leading-5" : builder ? "text-[14px] font-medium" : "text-[14px]"}`}
                                >
                                    {name}
                                </span>
                                {builder ? null : (
                                    <span
                                        className={`text-[12px] text-colorTextSecondary ${phone ? "leading-4" : "leading-3"}`}
                                    >
                                        {t("agentSidebar.agent")}
                                    </span>
                                )}
                            </span>
                            <CaretUpDownIcon
                                size={14}
                                className="shrink-0 text-colorTextTertiary"
                            />
                        </>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[420px] w-[260px] overflow-y-auto">
                {builder ? (
                    <>
                        <DropdownMenuItem data-testid="agent-sidebar-switcher-builder">
                            <BuilderIcon size={16} />
                            <span className="truncate">{name}</span>
                            <CheckIcon
                                aria-hidden
                                size={14}
                                className="ml-auto shrink-0 text-colorTextSecondary"
                            />
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                <DropdownMenuLabel>{t("agentSidebar.agents")}</DropdownMenuLabel>
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
                    <DropdownMenuItem
                        key={agent.id}
                        disabled={agent.id === agentId}
                        onSelect={() => onPick(agent.id)}
                    >
                        <AgentChip workflowId={agent.id} box="size-4" glyph={10} />
                        <span className="truncate">{agentName(agent)}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
