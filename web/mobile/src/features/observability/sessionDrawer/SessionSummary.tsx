import {formatCurrency, formatLatency, formatTokenUsage} from "@agenta/shared/utils"

import type {SessionStats} from "./sessionTurns"

const Pill = ({label, value}: {label: string; value: string}) => (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-solid border-border text-sm">
        <span className="border-0 border-r border-solid border-border bg-muted px-2 py-0.5">
            {label}
        </span>
        <span className="px-2 py-0.5 text-nowrap">{value}</span>
    </div>
)

/** Totals for the whole session. The models pill is left out when no trace names a model. */
export const SessionSummary = ({stats}: {stats: SessionStats}) => (
    <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Summary</span>
        <div className="flex items-center gap-2 overflow-x-auto">
            <Pill label="Cost" value={formatCurrency(stats.cost)} />
            <Pill label="Tokens" value={formatTokenUsage(stats.tokens)} />
            <Pill label="Latency" value={formatLatency(stats.latency / 1000)} />
            {stats.models.length > 0 ? (
                <Pill label="Models" value={stats.models.join(", ")} />
            ) : null}
        </div>
    </div>
)
