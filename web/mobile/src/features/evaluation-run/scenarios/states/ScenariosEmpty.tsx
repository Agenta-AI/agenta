import {Empty, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"

/** A run with no scenarios. */
export const ScenariosEmpty = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyTitle>No scenarios</EmptyTitle>
        </EmptyHeader>
    </Empty>
)
