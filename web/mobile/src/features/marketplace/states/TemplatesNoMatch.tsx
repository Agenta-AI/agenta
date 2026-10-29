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

/** The catalog has templates, but none match the search or the filters. */
export const TemplatesNoMatch = ({term, onClear}: {term?: string; onClear: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
            <EmptyTitle>
                {term ? `No templates match “${term}”` : "No templates match these filters"}
            </EmptyTitle>
            <EmptyDescription>
                Try an app name like GitHub or Slack, or clear the filters.
            </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                Clear filters
            </Button>
        </EmptyContent>
    </Empty>
)
