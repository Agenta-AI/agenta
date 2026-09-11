import * as React from "react"

import {Slot} from "@radix-ui/react-slot"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Button — the shadcn button (Radix Slot + cva), sized off the `control-*`/`btn-*` scale; icons are
 * children and `LoadingButton` covers loading. antd mapping: primary→default, default→outline,
 * text→ghost, danger→destructive, small/middle/large→sm/default/lg.
 */
const buttonVariants = cva(
    [
        // CONTROL_RESET: preflight is disabled app-wide (antd ships its own reset), so the
        // resets preflight would normally provide are applied per-control. Delete these once
        // antd is gone and preflight is switched back on — see antd-inventory/GOTCHAS.md.
        "box-border border-solid font-[inherit] py-0",
        "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap",
        // Weight 400, not Nova's 500 — a deliberate house deviation.
        "border border-transparent bg-clip-padding font-normal",
        "cursor-pointer select-none transition-all",
        // Nova focus ring; color-mix because Tailwind v3 can't alpha-modify a `var()` colour.
        "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-[color:color-mix(in_srgb,var(--ag-colorPrimary)_50%,transparent)]",
        // Nova press nudge, skipped on menu/popover triggers.
        "active:[&:not([aria-haspopup])]:translate-y-px",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-error aria-invalid:ring-[3px] aria-invalid:ring-[color:color-mix(in_srgb,var(--ag-colorError)_20%,transparent)]",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    ],
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-btn-primary-fg hover:bg-[color-mix(in_srgb,var(--ag-colorPrimary)_80%,transparent)]",
                outline:
                    "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
                dashed: "border-dashed border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
                secondary:
                    "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--ag-colorFillSecondary),var(--ag-colorText)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
                ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
                // Hovers use `accent` (6%): `muted` is 4% here and vanishes on the warm rail.
                destructive:
                    "bg-[color-mix(in_srgb,var(--ag-colorError)_10%,transparent)] text-error hover:bg-[color-mix(in_srgb,var(--ag-colorError)_20%,transparent)] focus-visible:border-[color:color-mix(in_srgb,var(--ag-colorError)_40%,transparent)] focus-visible:ring-[color:color-mix(in_srgb,var(--ag-colorError)_20%,transparent)]",
                "destructive-outline":
                    "border-error bg-background text-error hover:bg-[color-mix(in_srgb,var(--ag-colorError)_10%,transparent)] focus-visible:border-[color:color-mix(in_srgb,var(--ag-colorError)_40%,transparent)] focus-visible:ring-[color:color-mix(in_srgb,var(--ag-colorError)_20%,transparent)]",
                link: "bg-transparent text-primary underline-offset-4 hover:underline",
            },
            // `has-[[data-icon=…]]` trims the padding on the icon side.
            size: {
                xs: "h-control-xs gap-btn-gap-sm px-btn-xs text-btn-xs rounded-control-sm has-[[data-icon=inline-start]]:pl-btn-icon-pad-sm has-[[data-icon=inline-end]]:pr-btn-icon-pad-sm [&_svg:not([class*='size-'])]:size-btn-icon-xs",
                sm: "h-control-sm gap-btn-gap-sm px-btn-sm text-btn-sm rounded-control-sm has-[[data-icon=inline-start]]:pl-btn-icon-pad-sm has-[[data-icon=inline-end]]:pr-btn-icon-pad-sm [&_svg:not([class*='size-'])]:size-btn-icon-sm",
                default:
                    "h-control gap-btn-gap px-btn text-btn-md rounded-control has-[[data-icon=inline-start]]:pl-btn-icon-pad has-[[data-icon=inline-end]]:pr-btn-icon-pad [&_svg:not([class*='size-'])]:size-btn-icon",
                lg: "h-control-lg gap-btn-gap px-btn-lg text-btn-lg rounded-control has-[[data-icon=inline-start]]:pl-btn-icon-pad has-[[data-icon=inline-end]]:pr-btn-icon-pad [&_svg:not([class*='size-'])]:size-btn-icon",
                "icon-xs":
                    "size-control-xs p-0 text-btn-xs rounded-control-sm [&_svg:not([class*='size-'])]:size-btn-icon-xs",
                "icon-sm":
                    "size-control-sm p-0 text-btn-sm rounded-control-sm [&_svg:not([class*='size-'])]:size-btn-icon-sm",
                icon: "size-control p-0 text-btn-md rounded-control [&_svg:not([class*='size-'])]:size-btn-icon",
                "icon-lg":
                    "size-control-lg p-0 text-btn-lg rounded-control [&_svg:not([class*='size-'])]:size-btn-icon",
            },
        },
        defaultVariants: {variant: "default", size: "default"},
    },
)

export interface ButtonProps
    extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

/**
 * A button holding one element and no text is an icon button, and wants the square `icon` size
 * rather than the text ramp's horizontal padding. Call sites kept omitting `size`, so icon-only
 * buttons rendered as wide as a labelled one. Only inferred when `size` is absent — passing any
 * size, `default` included, keeps exactly what was asked for.
 */
const inferIconSize = (children: React.ReactNode): "icon" | undefined => {
    const kids = React.Children.toArray(children)
    if (kids.length !== 1) return undefined
    return React.isValidElement(kids[0]) ? "icon" : undefined
}

function Button({className, variant = "default", size, asChild = false, ...props}: ButtonProps) {
    const Comp = asChild ? Slot : "button"
    // `asChild` hands rendering to the child, so its single element is the button, not an icon.
    const effectiveSize = size ?? (asChild ? undefined : inferIconSize(props.children))
    return (
        <Comp
            data-slot="button"
            data-variant={variant}
            data-size={effectiveSize ?? "default"}
            className={cn(buttonVariants({variant, size: effectiveSize, className}))}
            {...props}
        />
    )
}

export {Button, buttonVariants}
