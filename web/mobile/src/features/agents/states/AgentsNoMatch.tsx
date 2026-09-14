import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {Filter, Search} from "lucide-react"

/**
 * The project has agents, but none the reader asked for.
 *
 * Distinct from `AgentsEmpty`: a project whose agents a filter has hidden must not be told it
 * has none, and the way out is the control that narrowed it — so this carries the action rather
 * than leaving the reader to work out which of three rows is set.
 */
export const AgentsNoMatch = ({
    term,
    onClear,
}: {
    /** The search that matched nothing. Absent ⇒ the filters are what narrowed it. */
    term?: string
    onClear?: () => void
}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
            <EmptyTitle>
                {term ? `Nothing matches “${term}”` : "No agents match these filters"}
            </EmptyTitle>
            <EmptyDescription>
                {term
                    ? "Try a shorter search, or check the filters — they narrow this list too."
                    : "Try widening the filters, or including archived agents."}
            </EmptyDescription>
        </EmptyHeader>
        {onClear ? (
            <EmptyContent>
                <Button size="sm" variant="outline" onClick={onClear}>
                    {term ? "Clear search" : "Clear filters"}
                </Button>
            </EmptyContent>
        ) : null}
    </Empty>
)
