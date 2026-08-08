/**
 * The session filters — the whole panel, extracted from the desktop rail. The controls bind to
 * the shared filter atoms (`useSessionFilters` / the control components), so desktop's 280px
 * rail and mobile's stacked sheet render the same filter state. The agent picker runs on the
 * kit Select and takes the host's agent list (each app resolves its roster differently).
 */
import type {ReactNode} from "react"

import {useSessionFilters} from "@agenta/sessions/state"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"

import {
    SessionArchivedControl,
    SessionModeControl,
    SessionSearchControl,
    SessionStatusListControl,
} from "./controls/SessionFilterControls"

const RailLabel = ({children}: {children: ReactNode}) => (
    <h2 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

const ALL_AGENTS = "__all__"

export interface SessionFiltersPanelProps {
    title?: string
    waitingCount: number | undefined
    /** The agent roster for the picker; empty/omitted hides it (as does `hideAgentFilter`). */
    agents?: {id: string; name: string}[]
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
    className?: string
}

export const SessionFiltersPanel = ({
    title,
    waitingCount,
    agents,
    hideAgentFilter,
    className,
}: SessionFiltersPanelProps) => {
    const {agentId, setAgentId} = useSessionFilters()

    return (
        <aside
            className={
                className ??
                "box-border flex w-full shrink-0 flex-col gap-6 overflow-y-auto border-0 border-solid border-colorBorderSecondary px-6 py-6 lg:w-[280px] lg:border-r lg:bg-colorFillQuaternary"
            }
        >
            {title ? (
                <h1 className="m-0 text-[24px] font-semibold leading-tight text-colorText">
                    {title}
                </h1>
            ) : null}

            <SessionSearchControl />

            <SessionStatusListControl waitingCount={waitingCount} />

            {hideAgentFilter || !agents?.length ? null : (
                <section className="flex flex-col gap-2">
                    <RailLabel>Agent</RailLabel>
                    <Select
                        value={agentId ?? ALL_AGENTS}
                        onValueChange={(value) => setAgentId(value === ALL_AGENTS ? null : value)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="All agents" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_AGENTS}>All agents</SelectItem>
                            {agents.map((agent) => (
                                <SelectItem key={agent.id} value={agent.id}>
                                    {agent.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </section>
            )}

            {/* Two different kinds of switch, so two headings: one picks WHICH sessions, the
                other widens the set. Under one "Include" label they read as the same thing. */}
            <section className="flex flex-col gap-3">
                <RailLabel>Show</RailLabel>
                <SessionModeControl />
            </section>

            <section className="flex flex-col gap-3">
                <RailLabel>Include</RailLabel>
                <SessionArchivedControl />
            </section>
        </aside>
    )
}
