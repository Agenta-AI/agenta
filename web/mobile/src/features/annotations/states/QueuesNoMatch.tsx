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

/** Queues exist, but the search or the type filter hid them; offers the way back. */
export const QueuesNoMatch = ({term, onClear}: {term?: string; onClear: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
            <EmptyTitle>
                {term ? "No queues match your search" : "No queues match your filters"}
            </EmptyTitle>
            <EmptyDescription>
                {term
                    ? `No annotation queues matched "${term}". Try a different name or clear the search.`
                    : "Try another type or clear the filter."}
            </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                {term ? "Clear search" : "Clear filter"}
            </Button>
        </EmptyContent>
    </Empty>
)
