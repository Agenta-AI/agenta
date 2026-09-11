import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {Bot} from "lucide-react"

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
    <Empty className="py-16">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Bot />
            </EmptyMedia>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>
                An agent is something you can chat with and hand work to. Create one from the button
                above, blank or from a template.
            </EmptyDescription>
        </EmptyHeader>
    </Empty>
)
