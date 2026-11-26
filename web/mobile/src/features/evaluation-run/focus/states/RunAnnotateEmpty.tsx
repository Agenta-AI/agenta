import {Empty, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"

/** A human run with no scenarios to annotate. */
export const RunAnnotateEmpty = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyTitle>No scenarios to display.</EmptyTitle>
        </EmptyHeader>
    </Empty>
)
