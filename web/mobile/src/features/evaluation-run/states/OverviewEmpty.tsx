import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"

import {cn} from "@/lib/utils"

/** A titled empty state inside an overview card: no data yet, or not enough to chart. */
export const OverviewEmpty = ({
    title,
    description,
    className,
}: {
    title: string
    description?: string
    className?: string
}) => (
    <Empty className={cn("py-8", className)}>
        <EmptyHeader>
            <EmptyTitle className="text-body">{title}</EmptyTitle>
            {description ? (
                <EmptyDescription className="text-meta">{description}</EmptyDescription>
            ) : null}
        </EmptyHeader>
    </Empty>
)
