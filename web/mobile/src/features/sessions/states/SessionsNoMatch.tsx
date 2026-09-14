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
 * The list has sessions, but none the reader asked for.
 *
 * Distinct from `SessionsEmpty`: a project with sessions that a filter has hidden must not be
 * told it has none, and the way out is the control that narrowed it — so this carries the action
 * rather than leaving the reader to work out which of four rows is set.
 */
export const SessionsNoMatch = ({
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
                {term ? `Nothing matches “${term}”` : "No session matches these filters"}
            </EmptyTitle>
            <EmptyDescription>
                {term
                    ? "Try a shorter search, or check the filters — they narrow this list too."
                    : "Every session is hidden by the filters on this list."}
            </EmptyDescription>
        </EmptyHeader>
        {onClear ? (
            <EmptyContent>
                <Button size="sm" variant="outline" onClick={onClear}>
                    {term ? "Clear search" : "Reset filters"}
                </Button>
            </EmptyContent>
        ) : null}
    </Empty>
)
