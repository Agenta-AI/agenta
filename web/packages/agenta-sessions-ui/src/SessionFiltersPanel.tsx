/** The whole filters panel, bound to the shared filter atoms; the host supplies its agent list.
 *  The rail box belongs to `FilterRailLayout`, not here. */
import type {ReactNode} from "react"

import {
    SessionAgentControl,
    SessionArchivedControl,
    SessionModeControl,
    SessionSearchControl,
    SessionStatusListControl,
} from "./controls/SessionFilterControls"

const RailLabel = ({children}: {children: ReactNode}) => (
    <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

export interface SessionFiltersPanelProps {
    /**
     * Before the title — a surface with no page chrome of its own puts its nav entry here (mobile's
     * drawer trigger), instead of a second bar that repeats this title.
     */
    leading?: ReactNode
    title?: string
    waitingCount: number | undefined
    /** The agent roster for the picker; empty/omitted hides it (as does `hideAgentFilter`). */
    agents?: {id: string; name: string}[]
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
    className?: string
}

export const SessionFiltersPanel = ({
    leading,
    title,
    waitingCount,
    agents,
    hideAgentFilter,
    className,
}: SessionFiltersPanelProps) => {
    return (
        <div className={`flex min-w-0 flex-col gap-6 ${className ?? ""}`}>
            {title || leading ? (
                <div className="flex min-w-0 items-center gap-2">
                    {leading}
                    {title ? (
                        <h1 className="m-0 min-w-0 flex-1 truncate text-[24px] font-semibold leading-tight text-colorText">
                            {title}
                        </h1>
                    ) : null}
                </div>
            ) : null}

            <SessionSearchControl />

            <SessionStatusListControl waitingCount={waitingCount} />

            {hideAgentFilter || !agents?.length ? null : (
                <section className="flex flex-col gap-2">
                    <RailLabel>Agent</RailLabel>
                    <SessionAgentControl agents={agents} />
                </section>
            )}

            {/* Two headings: one switch picks WHICH sessions, the other widens the set. */}
            <section className="flex flex-col gap-3">
                <RailLabel>Show</RailLabel>
                <SessionModeControl />
            </section>

            <section className="flex flex-col gap-3">
                <RailLabel>Include</RailLabel>
                <SessionArchivedControl />
            </section>
        </div>
    )
}
