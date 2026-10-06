import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

/** One way to run the agent: its mark, what it is, and the verb that sets it up. */
export const OnboardingModelOption = ({
    icon,
    title,
    hint,
    action,
    muted = false,
}: {
    icon: ReactNode
    title: ReactNode
    hint: string
    action: ReactNode
    muted?: boolean
}) => (
    <div className="border-border bg-background flex items-center justify-between gap-4 rounded-xl border border-solid p-4">
        <span className={cn("flex min-w-0 items-center gap-3", muted && "text-muted-foreground")}>
            {icon}
            <span className="min-w-0">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="text-muted-foreground block text-xs">{hint}</span>
            </span>
        </span>
        <span className="shrink-0">{action}</span>
    </div>
)
