import {Robot} from "@phosphor-icons/react"

/**
 * No agents at all.
 *
 * Sits INSIDE the table, under the header row, like its sessions and automations counterparts:
 * the columns are still true, and a project with no agents is a table with no rows rather than a
 * different screen. So it carries no card and no frame of its own.
 *
 * No button either — New agent is already pinned in the bar above, and a second create control
 * two rows below the first is not a shorter path.
 */
export const AgentsEmpty = () => (
    <div className="flex flex-col items-center justify-center gap-2.5 px-8 py-16 text-center">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted">
            <Robot aria-hidden size={19} className="text-muted-foreground" />
        </span>
        <p className="m-0 text-[14px] font-medium text-foreground">No agents yet</p>
        <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
            An agent is something you can chat with and hand work to. Create one from the button
            above, blank or from a template.
        </p>
    </div>
)
