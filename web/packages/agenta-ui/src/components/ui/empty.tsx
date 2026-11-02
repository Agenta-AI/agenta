import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Empty — shadcn's composable empty state: Empty > EmptyHeader (EmptyMedia, EmptyTitle,
 * EmptyDescription) + EmptyContent. `EmptyState`/`EmptyPlaceholder` are the antd-shaped facades.
 */
function Empty({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="empty"
            // border-0: preflight is off, so a bare `border-dashed` would paint a 3px default. Opt in with `border`.
            className={cn(
                "box-border flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-0 border-dashed p-6 text-center text-balance",
                className,
            )}
            {...props}
        />
    )
}

function EmptyHeader({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="empty-header"
            className={cn("flex max-w-sm flex-col items-center gap-2", className)}
            {...props}
        />
    )
}

const emptyMediaVariants = cva(
    "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default: "bg-transparent",
                icon: "size-8 rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4",
            },
        },
        defaultVariants: {variant: "default"},
    },
)

function EmptyMedia({
    className,
    variant = "default",
    ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
    return (
        <div
            data-slot="empty-icon"
            data-variant={variant}
            className={cn(emptyMediaVariants({variant}), className)}
            {...props}
        />
    )
}

function EmptyTitle({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="empty-title"
            className={cn("text-sm font-medium tracking-tight", className)}
            {...props}
        />
    )
}

function EmptyDescription({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="empty-description"
            className={cn(
                "text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
                className,
            )}
            {...props}
        />
    )
}

function EmptyContent({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="empty-content"
            className={cn(
                "flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-sm text-balance",
                className,
            )}
            {...props}
        />
    )
}

export {
    Empty,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription,
    EmptyContent,
    emptyMediaVariants,
}
