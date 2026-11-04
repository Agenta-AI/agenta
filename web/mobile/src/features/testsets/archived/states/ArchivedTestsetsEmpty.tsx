import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {Archive} from "lucide-react"

/** The project has no archived test sets. A search with no match uses `TestsetsNoMatch`. */
export const ArchivedTestsetsEmpty = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Archive />
            </EmptyMedia>
            <EmptyTitle className="text-foreground">No archived test sets</EmptyTitle>
        </EmptyHeader>
    </Empty>
)
