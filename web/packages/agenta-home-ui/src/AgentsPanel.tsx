import {useMemo, type ReactNode} from "react"

import {AgentCard, type AgentCardData} from "@agenta/entity-ui/agent"
import {PANEL_ACTION_CLASS, PanelSection} from "@agenta/ui/components/presentational"
import {ArrowRightIcon, PlusIcon} from "@phosphor-icons/react"
import Link from "next/link"

import {AgentActivity} from "./AgentActivity"
import {useWaitingByAgent} from "./useAgentActivity"

export interface AgentsPanelEntry {
    agent: AgentCardData
    /** Fallback for the recency sort when the agent has never been updated. */
    createdAt?: string | null
    /**
     * The creator, for the grid card's footer. The only cell still host-supplied: it needs a
     * user directory, which this package has no business knowing about. The waiting badge and
     * the last-run line are derived HERE (see the component doc) so no surface can ship without
     * them.
     */
    owner?: ReactNode
    onOpenOverview: () => void
    /** Omit what this surface cannot do — the card drops the matching menu entry. */
    onOpenPlayground?: () => void
    onRename?: () => void
    onArchive?: () => void
}

export interface AgentsPanelProps {
    entries: AgentsPanelEntry[]
    loading?: boolean
    /** The full roster. */
    allAgentsHref: string
    /** Creating an agent. Omit on surfaces that cannot create one yet. */
    onNewAgent?: () => void
    /** Shown instead of the list when there are no agents. */
    empty?: ReactNode
    /** The rail is a shortlist — a big project would otherwise mount hundreds of cards, each
     * with its own activity query, into a 340px column. */
    limit?: number
}

const DEFAULT_LIMIT = 5

/**
 * The agents roster as the rail shows it: a shortlist of cards, "New agent", "All agents".
 * The same card the Agents page renders — the two differ in how much room they have, not in
 * what an agent IS.
 *
 * The waiting count and the last-run line are derived here rather than passed in. They are the
 * roster's only operational information, they come from the shared session queries, and leaving
 * them to the host meant one app rendered a roster of bare names.
 */
export const AgentsPanel = ({
    entries,
    loading = false,
    allAgentsHref,
    onNewAgent,
    empty,
    limit = DEFAULT_LIMIT,
}: AgentsPanelProps) => {
    // Recency is re-derived here rather than trusted from whatever order the host's query
    // returned — the workflows window is ordered by CREATION, so an old agent used yesterday
    // would sink below a new one never run. Sorting in the hosts instead is what let the two
    // apps show the same four agents in two different orders.
    const shown = useMemo(
        () =>
            [...entries]
                .sort(
                    (a, b) =>
                        Date.parse(b.agent.updatedAt ?? b.createdAt ?? "") -
                        Date.parse(a.agent.updatedAt ?? a.createdAt ?? ""),
                )
                .slice(0, limit),
        [entries, limit],
    )
    const waitingByAgent = useWaitingByAgent()

    return (
        <PanelSection
            sticky
            title="Your agents"
            bodyClassName="flex flex-col gap-1 px-2 pb-3"
            extra={
                <div className="flex shrink-0 items-center gap-3">
                    {onNewAgent ? (
                        <button type="button" onClick={onNewAgent} className={PANEL_ACTION_CLASS}>
                            <PlusIcon size={14} />
                            New agent
                        </button>
                    ) : null}
                    {/* An arrow means the action leaves the page. In-place reveals
                        ("View all 28", "Expand") deliberately don't carry one. */}
                    <Link href={allAgentsHref} className={PANEL_ACTION_CLASS}>
                        All agents
                        <ArrowRightIcon size={12} />
                    </Link>
                </div>
            }
        >
            {loading ? (
                <div className="flex flex-col gap-2 px-4 pb-4">
                    {[0, 1, 2].map((row) => (
                        <div
                            key={row}
                            className="h-12 animate-pulse rounded bg-colorFillTertiary"
                        />
                    ))}
                </div>
            ) : shown.length === 0 ? (
                empty
            ) : (
                shown.map((entry) => (
                    <AgentCard
                        key={entry.agent.id}
                        agent={entry.agent}
                        waiting={waitingByAgent.get(entry.agent.id) ?? 0}
                        variant="rail"
                        activity={<AgentActivity agentId={entry.agent.id} />}
                        owner={entry.owner}
                        onOpenOverview={entry.onOpenOverview}
                        onOpenPlayground={entry.onOpenPlayground}
                        onRename={entry.onRename}
                        onArchive={entry.onArchive}
                    />
                ))
            )}
        </PanelSection>
    )
}
