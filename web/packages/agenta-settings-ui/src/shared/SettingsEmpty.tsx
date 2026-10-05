import type {ReactNode} from "react"

import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"

/** An empty Settings list: what it is for and the one way to start it. */
export const SettingsEmpty = ({
    icon,
    title,
    description,
    action,
}: {
    icon?: ReactNode
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
}) => (
    <Empty className="rounded-xl border border-solid border-border bg-[radial-gradient(var(--ag-colorBorder)_1px,transparent_1px)] bg-[size:16px_16px] py-14">
        <EmptyHeader>
            {icon ? (
                <EmptyMedia
                    variant="icon"
                    className="border border-solid border-border bg-background shadow-sm"
                >
                    {icon}
                </EmptyMedia>
            ) : null}
            <EmptyTitle className="text-[15px] font-semibold">{title}</EmptyTitle>
            {description ? (
                <EmptyDescription className="text-[13.5px]">{description}</EmptyDescription>
            ) : null}
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
)
