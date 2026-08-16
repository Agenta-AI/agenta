import type {ReactNode} from "react"

import {SessionListCard, type SessionListCardProps} from "@agenta/sessions-ui"
import {PanelScroll, PanelSurface} from "@agenta/ui/components/presentational"

import {AgentConfigSummaryCard} from "./AgentConfigSummaryCard"
import {AgentFilesCard} from "./AgentFilesCard"
import {AgentOverviewLayout} from "./AgentOverviewLayout"
import {NextTriggersSection} from "./NextTriggersSection"

export interface AgentOverviewBodyProps {
    agentId: string
    /** Where both list cards' "View all" lands. */
    sessionsHref: string
    /**
     * The start-a-session composer, above the lists. Host-owned because starting a session is:
     * the desktop opens the playground transport, mobile routes to its chat screen.
     */
    composer?: ReactNode
    /** Opens configuration for editing; omit on a read-only host and the card stays read-only. */
    onEditConfig?: () => void
    /** Usage strip, last in the rail. Host-owned while the range control is app state. */
    usage?: ReactNode
    /** Row menu + open verbs for the list cards — the host's routing. */
    onOpenRow: SessionListCardProps["onOpenRow"]
    menuFor?: SessionListCardProps["menuFor"]
    onMenuSelect?: SessionListCardProps["onMenuSelect"]
    /** Touch hosts keep the pin visible instead of revealing it on hover. */
    alwaysShowPin?: boolean
    /** Display names for the triggers section's bound-agent labels. */
    agentNames?: Map<string, string>
}

/**
 * THE agent overview body — one composition for the desktop page and the mobile screen. Activity
 * reads on the left (composer, then sessions and automation runs as co-equal cards); the agent's
 * own state stands in the rail on the right, in one order: what it IS, what it CARRIES, what it
 * WILL DO, what it COST. Hosts supply only what is genuinely theirs — how a session starts, how a
 * row opens, and the usage strip.
 */
export const AgentOverviewBody = ({
    agentId,
    sessionsHref,
    composer,
    onEditConfig,
    usage,
    onOpenRow,
    menuFor,
    onMenuSelect,
    alwaysShowPin,
    agentNames,
}: AgentOverviewBodyProps) => (
    <AgentOverviewLayout
        scroll
        main={
            <>
                {composer}
                {/* Bare, on the page background — the rail opposite is the page's one defined
                    object, and two sheets facing each other read as equal weight. */}
                <div className="flex flex-col gap-10">
                    <SessionListCard
                        withPinned
                        title="Sessions"
                        agentId={agentId}
                        limit={6}
                        emptyText="Conversations with this agent will show up here."
                        viewAllHref={sessionsHref}
                        alwaysShowPin={alwaysShowPin}
                        onOpenRow={onOpenRow}
                        menuFor={menuFor}
                        onMenuSelect={onMenuSelect}
                    />
                    {/* Co-equal with Sessions, not a filter of it: an automation run is one the
                        user configured but did not start. */}
                    <SessionListCard
                        withPinned
                        title="Automation runs"
                        agentId={agentId}
                        origin="trigger"
                        limit={5}
                        minHeightClassName="min-h-[100px]"
                        emptyText="Runs from automations bound to this agent will show up here."
                        viewAllHref={sessionsHref}
                        alwaysShowPin={alwaysShowPin}
                        onOpenRow={onOpenRow}
                        menuFor={menuFor}
                        onMenuSelect={onMenuSelect}
                    />
                </div>
            </>
        }
        rail={
            <PanelSurface className="flex max-h-full min-h-0 flex-col">
                <PanelScroll>
                    <AgentConfigSummaryCard appId={agentId} onEdit={onEditConfig} />
                    <AgentFilesCard appId={agentId} />
                    {/* Scoped to this agent. Automation RUNS say what already happened; an agent
                        whose schedule quietly stopped looks identical there. */}
                    <NextTriggersSection agentId={agentId} agentNames={agentNames} />
                    {usage}
                </PanelScroll>
            </PanelSurface>
        }
    />
)
