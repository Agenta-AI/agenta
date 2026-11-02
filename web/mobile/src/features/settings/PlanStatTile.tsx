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
    value: string
    note: ReactNode
    action?: ReactNode
}) => (
    <AnalyticsCard
        className="min-h-[108px]"
        title={label}
        value={<AnimatedNumber value={value} />}
        note={
            <span className="flex items-center justify-between gap-2">
                <span className="truncate">{note}</span>
                {action}
            </span>
        }
    />
)
