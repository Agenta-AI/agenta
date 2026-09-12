import {ChatCircleDots} from "@phosphor-icons/react"

/**
 * No sessions at all.
 *
 * Sits INSIDE the table, under the header row, like its automations counterpart: the columns are
 * still true, and a project with no sessions is a table with no rows rather than a different
 * screen. So it carries no card and no frame of its own.
 *
 * No button either — a session starts from Home or from an agent, not from the list that shows
 * them, so the line under the heading says where instead of offering an action this screen
 * cannot perform.
 */
export const SessionsEmpty = () => (
    <div className="flex flex-col items-center justify-center gap-2.5 px-8 py-16 text-center">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted">
            <ChatCircleDots aria-hidden size={19} className="text-muted-foreground" />
        </span>
        <p className="m-0 text-[14px] font-medium text-foreground">No sessions yet</p>
        <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
            A session is one conversation with an agent. Start one from Home and it will show up
            here, alongside anything your automations run.
        </p>
    </div>
)
