import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Badge — an @agenta/ui component re-skinned to the app theme via the shared
 * `--ag-*` token bridge (oss/tailwind.config.ts `shadcnTokens`). Consolidates the
 * antd tag/status presets (DraftTag / SyncStateTag / StatusTag / SourceIndicator /
 * VersionBadge / MappingStatusTag / TypeChip) into one component + semantic variants.
 *
 * Geometry matches antd Tag exactly and comes from the `control-*` theme scale (12px
 * font, 22.4px line-height, 0×7px padding, 6px radius, 1px border) — retune it there, not
 * here. `border-solid` is required because the app runs Tailwind with preflight OFF (the
 * `border` utility sets width but style defaults to `none`). Colors resolve through the
 * palette-derived layer, so they
 * flip light↔dark with the app theme and do not depend on antd being mounted.
 */
const badgeVariants = cva(
    [
        // CONTROL_RESET — see button.tsx (preflight is off app-wide for antd's sake).
        "box-border border-solid",
        "inline-flex items-center gap-1 whitespace-nowrap border border-transparent transition-colors",
        // Geometry from the control scale, never raw pixels.
        "rounded-control-sm px-input-sm text-badge-md",
    ],
    {
        variants: {
            variant: {
                default: "bg-chip text-foreground",
                success: "bg-success-bg text-success",
                warning: "bg-warning-bg text-warning",
                error: "bg-error-bg text-error",
                info: "bg-info-bg text-info",
                processing: "bg-info-bg text-info",
                draft: "bg-draft-bg border-draft-border text-draft font-normal",
                // antd preset Tag colors (color="blue"/"green").
                blue: "bg-tag-blue-bg text-tag-blue",
                green: "bg-tag-green-bg text-tag-green",
                orange: "bg-tag-orange-bg text-tag-orange",
                red: "bg-tag-red-bg text-tag-red",
                purple: "bg-tag-purple-bg text-tag-purple",
                cyan: "bg-tag-cyan-bg text-tag-cyan",
                magenta: "bg-tag-magenta-bg text-tag-magenta",
                gold: "bg-tag-gold-bg text-tag-gold",
                outlined: "bg-chip border-border text-foreground",
            },
        },
        defaultVariants: {variant: "default"},
    },
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
    icon?: React.ReactNode
}

export function Badge({className, variant, icon, children, ...props}: BadgeProps) {
    return (
        <span data-slot="badge" className={cn(badgeVariants({variant}), className)} {...props}>
            {icon}
            {children}
        </span>
    )
}

export {badgeVariants}
