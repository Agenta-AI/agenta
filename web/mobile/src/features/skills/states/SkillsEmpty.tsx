import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {Sparkles} from "lucide-react"

/**
 * No skills at all.
 *
 * Sits INSIDE the table, under the header row, like the agents and automations lists: the
 * columns are still true, and a project with no skills is a table with no rows rather than a
 * different screen. No button — New skill is already pinned in the bar above.
 */
export const SkillsEmpty = () => (
    <Empty className="py-16">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Sparkles />
            </EmptyMedia>
            <EmptyTitle>No skills yet</EmptyTitle>
            <EmptyDescription>
                A skill is a folder of instructions an agent can pick up. Write one from scratch,
                upload a folder, or import from a repo with the button above.
            </EmptyDescription>
        </EmptyHeader>
    </Empty>
)
