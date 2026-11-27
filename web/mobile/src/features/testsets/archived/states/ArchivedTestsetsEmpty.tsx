import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {ArchiveIcon} from "@phosphor-icons/react"

/** The project has no archived test sets. A search with no match uses `TestsetsNoMatch`. */
export const ArchivedTestsetsEmpty = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <ArchiveIcon />
            </EmptyMedia>
            <EmptyTitle className="text-foreground">No archived test sets</EmptyTitle>
        </EmptyHeader>
    </Empty>
)
