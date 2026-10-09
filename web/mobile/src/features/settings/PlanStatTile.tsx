import type {ReactNode} from "react"

import {AnalyticsCard} from "@agenta/observability-ui/analytics"

import {AnimatedNumber} from "@/components/AnimatedNumber"

/** One plan limit: what it is, its value, and the line that qualifies it. */
export const PlanStatTile = ({
    label,
    value,
    note,
    action,
}: {
    label: ReactNode
    value: ReactNode
    note: ReactNode
    action?: ReactNode
}) => (
    <AnalyticsCard
        className="min-h-[108px]"
        title={label}
        value={
            typeof value === "string" || typeof value === "number" ? (
                <AnimatedNumber value={String(value)} />
            ) : (
                <span className="tabular-nums">{value}</span>
            )
        }
        note={
            <span className="flex items-center justify-between gap-2">
                <span className="truncate">{note}</span>
                {action}
            </span>
        }
    />
)
