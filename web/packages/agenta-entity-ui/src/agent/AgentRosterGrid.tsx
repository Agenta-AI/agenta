/**
 * THE agents roster — the card grid every app's Agents page renders. Extracted from the desktop
 * page (whose `AgentsGrid` now maps onto this), so a roster is the same object on every surface:
 * the same cards, the same waiting badge, the same dashed create cell, the same empty state.
 *
 * It owns the mapping from roster entries to `AgentCard`s inside `AgentCardGrid`. What stays with
 * the host is only what the host alone can supply: its verbs (an entry omitted here loses its menu
 * item, so a surface never offers something it cannot do) and the data-connected cells — last
 * activity and creator, which need queries and reference components the package does not own.
 */
import type {ReactNode} from "react"

import {AgentCard} from "./AgentCard"
import {AgentCardGrid} from "./AgentCardGrid"

/** What the roster needs of an agent. Both apps' row shapes map onto this. */
export interface AgentRosterEntry {
    id: string
    name: string
    description?: string | null
    /** ISO timestamp of the last configuration change — the card footer's right edge. */
    updatedAt?: string | null
}

export interface AgentRosterGridProps {
    agents: AgentRosterEntry[]
    isLoading?: boolean
    /** Sessions blocked on you, per agent id — the amber badge. Omit where a surface has no poll. */
    waitingByAgent?: Map<string, number>
    /** `grid` is the Agents page; `rail` is a narrow column (Home). */
    variant?: "rail" | "grid"
    onOpenOverview: (agent: AgentRosterEntry) => void
    onOpenPlayground?: (agent: AgentRosterEntry) => void
    onRename?: (agent: AgentRosterEntry) => void
    onArchive?: (agent: AgentRosterEntry) => void
    /** Omit to hide the dashed create cell (a read-only roster). */
    onCreate?: () => void
    createLabel?: string
    createHint?: string
    /** Last-activity cell (needs the host's session query). */
    renderActivity?: (agent: AgentRosterEntry) => ReactNode
    /** Creator cell (needs the host's user references). */
    renderOwner?: (agent: AgentRosterEntry) => ReactNode
    emptyText?: string
}

export const AgentRosterGrid = ({
    agents,
    isLoading = false,
    waitingByAgent,
    variant = "grid",
    onOpenOverview,
    onOpenPlayground,
    onRename,
    onArchive,
    onCreate,
    createLabel,
    createHint,
    renderActivity,
    renderOwner,
    emptyText,
}: AgentRosterGridProps) => (
    <AgentCardGrid
        isLoading={isLoading}
        count={agents.length}
        onCreate={onCreate}
        createLabel={createLabel}
        createHint={createHint}
        emptyText={emptyText}
    >
        {agents.map((agent) => (
            <AgentCard
                key={agent.id}
                agent={agent}
                waiting={waitingByAgent?.get(agent.id) ?? 0}
                variant={variant}
                activity={renderActivity?.(agent)}
                owner={renderOwner?.(agent)}
                onOpenOverview={() => onOpenOverview(agent)}
                onOpenPlayground={onOpenPlayground ? () => onOpenPlayground(agent) : undefined}
                onRename={onRename ? () => onRename(agent) : undefined}
                onArchive={onArchive ? () => onArchive(agent) : undefined}
            />
        ))}
    </AgentCardGrid>
)
