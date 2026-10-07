import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

/** One way to pay for runs: its mark, what it is, and the verb or state beside it. */
export const OnboardingWayRow = ({
    icon,
    title,
    hint,
    action,
    active = false,
}: {
    icon: ReactNode
    title: string
    hint: string
    action: ReactNode
    /** The way the first agent runs on now. */
    active?: boolean
}) => (
    <div
        className={cn(
            "bg-background flex items-center gap-3 rounded-xl border border-solid p-4",
            active ? "border-foreground" : "border-border",
        )}
    >
        {icon}
        <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            <span className="text-muted-foreground block truncate text-xs">{hint}</span>
        </span>
        <span className="shrink-0">{action}</span>
    </div>
)
