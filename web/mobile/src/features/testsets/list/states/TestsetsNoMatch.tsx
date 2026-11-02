import {Button, Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {Search} from "lucide-react"

/** The project has testsets, but the search hid them all. Offers the way back. */
export const TestsetsNoMatch = ({term, onClear}: {term: string; onClear: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Search />
            </EmptyMedia>
            <EmptyTitle>No test sets match “{term}”</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                Clear search
            </Button>
        </EmptyContent>
    </Empty>
)
