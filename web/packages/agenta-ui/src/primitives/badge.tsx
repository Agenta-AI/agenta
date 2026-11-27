import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "../foundation/utils/cn"

// A short status or label. Five tones only: neutral and the four statuses (KIT-01).
const badgeVariants = cva(
    [
        "box-border border-solid border-0",
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-control-check px-1.5",
        "text-caption [&_svg]:size-3 [&_svg]:shrink-0",
    ],
    {
        variants: {
            variant: {
                default: "bg-secondary text-muted-foreground",
                success: "bg-success/10 text-success",
                warning: "bg-warning/10 text-warning",
                destructive: "bg-destructive/10 text-destructive",
                info: "bg-info/10 text-info",
            },
        },
        defaultVariants: {variant: "default"},
    },
)

/**
 * The desktop app's antd tag colours, each drawn as one of the five tones. Kept only so
 * `web/oss` still compiles; new code passes one of the five.
 */
const LEGACY_VARIANT = {
    error: "destructive",
    processing: "info",
    draft: "default",
    outlined: "default",
    blue: "info",
    geekblue: "info",
    cyan: "info",
    purple: "info",
    green: "success",
    lime: "success",
    orange: "warning",
    gold: "warning",
    yellow: "warning",
    volcano: "warning",
    red: "destructive",
    magenta: "destructive",
    pink: "destructive",
} as const satisfies Record<string, NonNullable<VariantProps<typeof badgeVariants>["variant"]>>

/** @deprecated The antd colour names; use one of the five tones. */
export type LegacyBadgeVariant = keyof typeof LEGACY_VARIANT

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    variant?: VariantProps<typeof badgeVariants>["variant"] | LegacyBadgeVariant
    icon?: React.ReactNode
}

export function Badge({className, variant, icon, children, ...props}: BadgeProps) {
    const tone =
        variant && variant in LEGACY_VARIANT
            ? LEGACY_VARIANT[variant as LegacyBadgeVariant]
            : (variant as VariantProps<typeof badgeVariants>["variant"])
    return (
        <span
            data-slot="badge"
            className={cn(badgeVariants({variant: tone}), className)}
            {...props}
        >
            {icon}
            {children}
        </span>
    )
}

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

const STATUS_VARIANT: Record<string, BadgeVariant> = {
    success: "success",
    processing: "info",
    running: "info",
    warning: "warning",
    error: "destructive",
    failed: "destructive",
}

/** Maps a domain status tone ("processing", "error", ...) to a Badge variant. */
export function statusBadgeVariant(tone: string | null | undefined): BadgeVariant {
    return (tone && STATUS_VARIANT[tone]) || "default"
}

export {badgeVariants}
