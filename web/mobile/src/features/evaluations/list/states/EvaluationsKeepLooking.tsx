import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {Search} from "lucide-react"

/**
 * A page of the list came back with no rows, but older runs remain. The filter by kind or app
 * reads a limited number of runs at a time, so an empty page is not yet an empty result.
 */
export const EvaluationsKeepLooking = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Search />
            </EmptyMedia>
            <EmptyTitle>No matching evaluations in the newest runs</EmptyTitle>
            <EmptyDescription>Load more to look through older runs.</EmptyDescription>
        </EmptyHeader>
    </Empty>
)
