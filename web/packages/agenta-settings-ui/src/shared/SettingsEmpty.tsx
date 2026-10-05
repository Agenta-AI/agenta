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
    <div aria-hidden className="relative mb-3 h-[104px] w-[300px] max-w-full">
        <div className="absolute inset-x-[14%] top-0 h-14 rounded-xl border border-solid border-border bg-[color-mix(in_srgb,var(--ag-colorBgElevated)_45%,var(--ag-colorBgContainer))]" />
        <div className="absolute inset-x-[7%] top-2.5 h-14 rounded-xl border border-solid border-border bg-[color-mix(in_srgb,var(--ag-colorBgElevated)_75%,var(--ag-colorBgContainer))]" />
        <div className="absolute inset-x-0 top-6 flex h-[72px] items-center gap-3 rounded-xl border border-solid border-border bg-colorBgElevated px-3.5 shadow-[0_12px_32px_-14px_rgba(0,0,0,0.45)]">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background [&_svg]:size-[18px]">
                {icon}
            </span>
            <span className="flex flex-1 flex-col gap-2">
                <span className="h-2 w-3/5 rounded-full bg-muted-foreground/25" />
                <span className="h-1.5 w-2/5 rounded-full bg-muted-foreground/15" />
            </span>
            <span className="h-6 w-14 rounded-full border border-dashed border-border bg-muted/40" />
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
}: {
    icon?: ReactNode
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
    /** A quieter second step beside the action, e.g. a docs link. */
    secondary?: ReactNode
    /** A plain icon instead of the ghost rows, for no-match and locked states. */
    plain?: boolean
}) => (
    <Empty
        className={
            plain
                ? "py-12"
                : "relative overflow-hidden rounded-2xl border border-solid border-border bg-muted/20 py-12"
        }
    >
        {/* Dots behind the ghost rows, fading out before the frame's edge. */}
        {plain ? null : (
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--ag-colorBorder)_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(ellipse_55%_50%_at_50%_32%,black,transparent)]"
            />
        )}
        <EmptyHeader className="relative max-w-md">
            {icon && !plain ? <GhostRows icon={icon} /> : null}
            {icon && plain ? (
                <EmptyMedia
                    variant="icon"
                    className="border border-solid border-border bg-background shadow-sm"
                >
                    {icon}
                </EmptyMedia>
            ) : null}
            <EmptyTitle className="text-[16px] font-semibold">{title}</EmptyTitle>
            {description ? (
                <EmptyDescription className="text-[13.5px]">{description}</EmptyDescription>
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
