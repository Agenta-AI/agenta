import type {ReactNode} from "react"

import {timeAgo} from "@agenta/shared/utils"

import {AutomationActiveSwitch} from "./AutomationActiveSwitch"

/**
 * The facts under the name: on/off, then what it runs and when it last changed.
 *
 * `trailing` is what a phone puts beside the switch — Test run, off the crowded title row.
 *
 * No owner clause — the trigger endpoints carry only a `created_by_id`, and there is no user
 * lookup in this stack to turn that into a name, so the line stops at the agent.
 */
export const AutomationMetaRow = ({
    active,
    agentName,
    updatedAt,
    onToggle,
    trailing,
}: {
    active: boolean
    agentName: string | null
    updatedAt: string | null
    onToggle: (next: boolean) => Promise<void>
    trailing?: ReactNode
}) => {
    const edited = updatedAt ? timeAgo(Date.parse(updatedAt)) : ""

    return (
        <div className="mb-1 mt-4 flex min-w-0 flex-wrap items-center gap-3.5">
            <AutomationActiveSwitch active={active} onToggle={onToggle} />
            {trailing}
            <span className="flex min-w-0 items-center gap-3.5">
                {/* The row wraps at phone width, where a divider is either dangling at the end
                    of one line or leading the next. It only separates when both parts share a
                    line. */}
                <span aria-hidden className="hidden h-4 w-px shrink-0 bg-border sm:block" />
                <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                    {agentName ? `Runs ${agentName}` : "No agent yet"}
                    {edited ? ` · edited ${edited}` : ""}
                </span>
            </span>
        </div>
    )
}
