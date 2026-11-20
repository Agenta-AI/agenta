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
        // antd is gone and preflight is switched back on.
        "box-border border-solid font-[inherit] py-0",
        "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap",
        // Weight 400, not shadcn's 500 — a house choice.
        "border border-transparent bg-clip-padding font-normal",
        "cursor-pointer select-none transition-all",
        // The shared 3px control outline.
        "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]",
        // Press nudge, skipped on menu/popover triggers.
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
                // The palette's own error pair (pink fill, dark red text), as the canvas draws it.
                destructive:
                    "bg-colorErrorBg text-error hover:bg-[color-mix(in_srgb,var(--ag-colorError)_8%,var(--ag-colorErrorBg))] focus-visible:border-[color:color-mix(in_srgb,var(--ag-colorError)_40%,transparent)] focus-visible:ring-[color:color-mix(in_srgb,var(--ag-colorError)_20%,transparent)]",
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
                // The canvas scale (design decision D1), for the surfaces the builder layout draws:
                // a 28px control, radius 6, 13px text and a 16px glyph. `sm` keeps its 8px radius
                // and 14px glyph because hundreds of other screens use it. The radii are literal
                // pixels: `rounded-sm` and `rounded-md` differ between the two apps.
                compact:
                    "h-control-sm gap-1.5 px-btn-sm text-btn-sm rounded-[6px] has-[[data-icon=inline-start]]:pl-btn-icon-pad has-[[data-icon=inline-end]]:pr-btn-icon-pad [&_svg:not([class*='size-'])]:size-btn-icon",
                // Below md the icon button is the canvas phone button: a 44px tap target, radius 8,
                // 20px glyph.
                "icon-compact":
                    "size-control-sm p-0 text-btn-sm rounded-[6px] [&_svg:not([class*='size-'])]:size-btn-icon max-md:size-11 max-md:rounded-[8px] max-md:[&_svg:not([class*='size-'])]:size-5",
            },
        },
        compoundVariants: [
            // A quiet control on the canvas scale reads secondary until it is hovered or open.
            {
                variant: "ghost",
                size: ["compact", "icon-compact"],
                className:
                    "text-colorTextSecondary hover:text-colorText aria-expanded:text-colorText",
            },
            {variant: "ghost", size: "compact", className: "px-2"},
        ],
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

/**
 * The size a labelled Button takes when its caller passes none. A surface that draws all its
 * buttons on one scale (the confirmation dialog) provides it, so every caller's footer follows.
 * An explicit `size` still wins, and an icon-only button still infers `icon`.
 */
const ButtonSizeContext = React.createContext<ButtonProps["size"]>(undefined)

function Button({className, variant = "default", size, asChild = false, ...props}: ButtonProps) {
    const Comp = asChild ? Slot : "button"
    const contextSize = React.useContext(ButtonSizeContext)
    // `asChild` hands rendering to the child, so its single element is the button, not an icon.
    const effectiveSize =
        size ?? (asChild ? contextSize : (inferIconSize(props.children) ?? contextSize))
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

export {Button, ButtonSizeContext, buttonVariants}
