import {useMemo, useState} from "react"

import {AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretUpDownIcon} from "@phosphor-icons/react"

/** Above this many agents the menu gets a search field. */
const SEARCH_FROM = 8

export interface SwitcherAgent {
    id: string
    name?: string | null
    slug?: string | null
}

const agentName = (agent: SwitcherAgent | undefined) => agent?.name || agent?.slug || ""

/**
 * The agent sidebar's switcher: the sidebar's agent, and a menu with every agent the person can
 * see. What a pick opens is the host's (`onPick`).
 */
export const AgentSidebarSwitcher = ({
    agents,
    agentId,
    collapsed,
    onPick,
}: {
    agents: SwitcherAgent[]
    agentId: string
    collapsed: boolean
    onPick: (agentId: string) => void
}) => {
    const t = useT(agentSidebarCatalog)
    const [search, setSearch] = useState("")
    const name = agentName(agents.find((agent) => agent.id === agentId))

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
                            : "flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 text-left text-colorText [font-family:inherit] hover:bg-colorFillTertiary"
                    }
                >
                    <AgentChip workflowId={agentId} box="size-7" glyph={16} />
                    {collapsed ? null : (
                        <>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-[14px] font-medium">{name}</span>
                                <span className="text-xs leading-3 text-colorTextSecondary">
                                    {t("agentSidebar.agent")}
                                </span>
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
                <DropdownMenuLabel>{t("agentSidebar.agents")}</DropdownMenuLabel>
                {agents.length > SEARCH_FROM ? (
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
