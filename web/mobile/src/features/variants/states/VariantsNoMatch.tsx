import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {Search} from "lucide-react"

/** The app has revisions, but the search hid all of them. */
export const VariantsNoMatch = ({term, onClear}: {term: string; onClear: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Search />
            </EmptyMedia>
            <EmptyTitle>No revisions match “{term}”</EmptyTitle>
            <EmptyDescription>Try a shorter search.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                Clear search
            </Button>
        </EmptyContent>
    </Empty>
)
