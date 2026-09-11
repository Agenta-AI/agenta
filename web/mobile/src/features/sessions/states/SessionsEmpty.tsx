import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {MessagesSquare} from "lucide-react"

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
    <Empty className="py-16">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <MessagesSquare />
            </EmptyMedia>
            <EmptyTitle>No sessions yet</EmptyTitle>
            <EmptyDescription>
                A session is one conversation with an agent. Start one from Home and it will show up
                here, alongside anything your automations run.
            </EmptyDescription>
        </EmptyHeader>
    </Empty>
)
