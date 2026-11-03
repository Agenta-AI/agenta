import {Empty, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"

/** The app exists but has no variant, so nothing can be deployed to an environment. */
export const EndpointsNoVariants = () => (
    <Empty className="py-14" data-testid="endpoints-no-variants">
        <EmptyHeader>
            <EmptyTitle>No variants available</EmptyTitle>
        </EmptyHeader>
    </Empty>
)
