/**
 * The session filters as a BAR — the compact shell for a narrow screen, where the rail's stacked
 * facets would push the list itself off the viewport. Same controls as `SessionFiltersPanel`, same
 * filter atoms; only the shell differs: title row, search, a one-line status strip, and everything
 * else (agent, the two toggles) behind a Filters sheet that carries a count of what is on.
 */
import {useState, type ReactNode} from "react"

import {useSessionFilters} from "@agenta/sessions/state"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetFooter,
} from "@agenta/ui/ui"
import {FunnelIcon} from "@phosphor-icons/react"

import {
    SessionAgentControl,
    SessionArchivedControl,
    SessionModeControl,
    SessionSearchControl,
    SessionStatusChipsControl,
} from "./controls/SessionFilterControls"

const SheetLabel = ({children}: {children: ReactNode}) => (
    <h2 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

export interface SessionFiltersBarProps {
    /** Before the title — the surface's nav entry (mobile's drawer trigger). */
    leading?: ReactNode
    title?: string
    waitingCount: number | undefined
    /** The agent roster for the picker; empty/omitted hides it (as does `hideAgentFilter`). */
    agents?: {id: string; name: string}[]
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
    className?: string
}

export const SessionFiltersBar = ({
    leading,
    title,
    waitingCount,
    agents,
    hideAgentFilter,
    className,
}: SessionFiltersBarProps) => {
    const [open, setOpen] = useState(false)
    const {agentId, mode, includeArchived, setAgentId, setMode, setIncludeArchived} =
        useSessionFilters()
    const showAgent = !hideAgentFilter && Boolean(agents?.length)
    const activeCount = (showAgent && agentId ? 1 : 0) + (mode ? 1 : 0) + (includeArchived ? 1 : 0)

    return (
        <div
            className={`box-border flex flex-col gap-3 border-x-0 border-t-0 border-b border-solid border-colorBorderSecondary px-4 pb-3 pt-3 ${
                className ?? ""
            }`}
        >
            <div className="flex min-w-0 items-center gap-2">
                {leading}
                {title ? (
                    <h1 className="m-0 min-w-0 flex-1 truncate text-[20px] font-semibold leading-tight text-colorText">
                        {title}
                    </h1>
                ) : (
                    <span className="flex-1" />
                )}

                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild>
                        <button
                            type="button"
                            aria-label="Filters"
                            className="box-border flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-colorFillQuaternary px-2.5 text-sm text-colorTextSecondary"
                        >
                            <FunnelIcon size={16} weight={activeCount ? "fill" : "regular"} />
                            Filters
                            {activeCount ? (
                                <span className="rounded bg-colorFillSecondary px-1.5 py-0.5 text-[11px] leading-none text-colorText">
                                    {activeCount}
                                </span>
                            ) : null}
                        </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="h-auto max-h-[80dvh] rounded-t-2xl">
                        <SheetHeader>
                            <SheetTitle>Filters</SheetTitle>
                        </SheetHeader>
                        <div className="flex flex-col gap-6 overflow-y-auto px-6 py-5">
                            {showAgent ? (
                                <section className="flex flex-col gap-2">
                                    <SheetLabel>Agent</SheetLabel>
                                    <SessionAgentControl agents={agents ?? []} />
                                </section>
                            ) : null}

                            <section className="flex flex-col gap-3">
                                <SheetLabel>Show</SheetLabel>
                                <SessionModeControl />
                            </section>

                            <section className="flex flex-col gap-3">
                                <SheetLabel>Include</SheetLabel>
                                <SessionArchivedControl />
                            </section>
                        </div>
                        {/* Only these three live in the sheet, so clearing here must not also wipe
                            the search and status the bar still shows. */}
                        <SheetFooter className="pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                            <button
                                type="button"
                                disabled={!activeCount}
                                onClick={() => {
                                    setAgentId(null)
                                    setMode(false)
                                    setIncludeArchived(false)
                                }}
                                className="box-border cursor-pointer rounded-lg border-0 bg-transparent px-3 py-1.5 text-sm text-colorTextSecondary disabled:cursor-default disabled:text-colorTextQuaternary"
                            >
                                Clear
                            </button>
                        </SheetFooter>
                    </SheetContent>
                </Sheet>
            </div>

            <SessionSearchControl />

            <SessionStatusChipsControl waitingCount={waitingCount} />
        </div>
    )
}
