import type {ReactNode} from "react"

import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"

/** A tool list with nothing to show: why, and the one action that helps. */
export const ToolsEmpty = ({
    icon,
    title,
    description,
    action,
}: {
    icon: ReactNode
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
}) => (
    <Empty className="rounded-xl border border-dashed border-border py-10">
        <EmptyHeader>
            <EmptyMedia
                variant="icon"
                className="border border-solid border-border bg-background shadow-sm"
            >
                {icon}
            </EmptyMedia>
            <EmptyTitle className="text-sm font-medium">{title}</EmptyTitle>
            {description ? (
                <EmptyDescription className="text-[13px]">{description}</EmptyDescription>
            ) : null}
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
)
