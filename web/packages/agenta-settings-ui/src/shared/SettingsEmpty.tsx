import type {ReactNode} from "react"

import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"

/** A ghost row of the list to come: the icon in a tile, skeleton text, an empty slot. */
const GhostRows = ({icon}: {icon: ReactNode}) => (
    <div aria-hidden className="relative mb-3 h-26 w-[300px] max-w-full">
        <div className="absolute inset-x-[14%] top-0 h-14 rounded-lg border border-solid border-border bg-background" />
        <div className="absolute inset-x-[7%] top-2.5 h-14 rounded-lg border border-solid border-border bg-background" />
        <div className="absolute inset-x-0 top-6 flex h-18 items-center gap-3 rounded-lg border border-solid border-border bg-background px-3.5">
            <span
                data-slot="empty-icon"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground [&_svg]:size-5"
            >
                {icon}
            </span>
            <span className="flex flex-1 flex-col gap-2">
                <span className="h-2 w-3/5 rounded-sm bg-muted-foreground/25" />
                <span className="h-1.5 w-2/5 rounded-sm bg-muted-foreground/15" />
            </span>
            <span className="h-6 w-14 rounded-md border border-dashed border-border bg-muted/40" />
        </div>
    </div>
)

/** An empty Settings list: what it is for and the one way to start it. */
export const SettingsEmpty = ({
    icon,
    title,
    description,
    action,
    secondary,
    plain = false,
    compact = false,
}: {
    icon?: ReactNode
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
    /** A quieter second step beside the action, e.g. a docs link. */
    secondary?: ReactNode
    /** A plain icon instead of the ghost rows, for no-match and locked states. */
    plain?: boolean
    /** One quiet row instead of the block: the connection pages' lists. */
    compact?: boolean
}) =>
    compact ? (
        <div
            data-slot="empty"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2.5"
        >
            {icon ? (
                <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground [&_svg]:size-4"
                >
                    {icon}
                </span>
            ) : null}
            <div className="flex min-w-0 flex-1 basis-56 flex-col">
                <span className="text-label font-medium text-foreground">{title}</span>
                {description ? (
                    <span className="text-meta text-muted-foreground">{description}</span>
                ) : null}
            </div>
            {action || secondary ? (
                <div className="flex shrink-0 items-center gap-2">
                    {action}
                    {secondary}
                </div>
            ) : null}
        </div>
    ) : (
        <Empty
            className={
                plain
                    ? "py-12"
                    : "relative overflow-hidden rounded-lg border border-solid border-border bg-muted py-16"
            }
        >
            {/* Dots behind the ghost rows, fading out before the frame's edge. */}
            {plain ? null : (
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(ellipse_55%_50%_at_50%_32%,black,transparent)]"
                />
            )}
            <EmptyHeader className="relative max-w-md">
                {icon && !plain ? <GhostRows icon={icon} /> : null}
                {icon && plain ? (
                    <EmptyMedia variant="icon" className="bg-muted">
                        {icon}
                    </EmptyMedia>
                ) : null}
                <EmptyTitle className="text-title">{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription className="text-label">{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
            {action || secondary ? (
                <EmptyContent className="relative flex-row justify-center gap-3">
                    {action}
                    {secondary}
                </EmptyContent>
            ) : null}
        </Empty>
    )
