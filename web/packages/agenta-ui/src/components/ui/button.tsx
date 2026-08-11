import * as React from "react"

import {Slot} from "@radix-ui/react-slot"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Button — a Radix + cva primitive in @agenta/ui, following shadcn's source conventions: no
 * `forwardRef` (React 19 passes `ref` as a prop) and a `data-slot` attribute. Radix `Slot` for
 * `asChild`, `cva` for variants.
 *
 * Deliberately minimal, like stock shadcn: no `icon`/`loading` props. Compose instead —
 * icons are children (the base handles svg sizing/spacing), and `LoadingButton` in
 * ./button-composed covers the loading state.
 *
 * Geometry/typography come from the `control-*` theme scale, never raw pixels, so the
 * whole control system is retunable in one place (see tailwind.config.ts `controlScale`).
 *
 * antd → @agenta/ui mapping (for migrating call-sites):
 *   type="primary"→"default"  type="default"→"outline"  type="text"→"ghost"
 *   type="link"→"link"  type="dashed"→"dashed"  danger→"destructive" (primary) or
 *   "destructive-outline" (default)  size small/middle/large→sm/default/lg
 *   shape="circle"→size="icon" + `rounded-control-round`
 */
const buttonVariants = cva(
    [
        // CONTROL_RESET: preflight is disabled app-wide (antd ships its own reset), so the
        // resets preflight would normally provide are applied per-control. Delete these once
        // antd is gone and preflight is switched back on — see antd-inventory/GOTCHAS.md.
        "box-border border-solid font-[inherit] py-0",
        "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-normal leading-normal",
        "cursor-pointer select-none transition-colors",
        // antd's keyboard focus ring: 4px solid colorPrimaryBorder, 1px offset, on
        // :focus-visible only (no ring on mouse click). No resting outline.
        "outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:text-disabled disabled:shadow-none",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    ],
    {
        variants: {
            variant: {
                // antd gives its solid/outlined/dashed buttons a `0 2px 0` shadow tinted per
                // colour family (primaryShadow/dangerShadow/defaultShadow — button/style/token.js
                // L47-49, wired in variant.js L84/L96/L152/L167/L188); text and link get none.
                default:
                    "bg-primary text-btn-primary-fg border-transparent shadow-[0_2px_0_var(--ag-controlOutline)] hover:bg-btn-primary-hover active:bg-btn-primary-active disabled:bg-disabled-bg",
                destructive:
                    "bg-error text-white border-transparent shadow-[0_2px_0_var(--ag-errorOutline)] hover:bg-error-hover active:bg-error-active",
                "destructive-outline":
                    "bg-background border-error text-error shadow-[0_2px_0_var(--ag-errorOutline)] hover:text-error-hover hover:border-error-hover active:text-error-active active:border-error-active",
                outline:
                    "border-border bg-btn-default-bg text-foreground shadow-[0_2px_0_var(--ag-colorFillQuaternary)] hover:bg-btn-default-hover-bg hover:border-btn-primary-hover hover:text-btn-primary-hover active:bg-btn-default-active-bg active:border-btn-primary-active active:text-btn-primary-active disabled:bg-disabled-bg",
                secondary:
                    "bg-secondary text-secondary-foreground border-transparent hover:bg-muted",
                // disabled:border-transparent is load-bearing: the base sets
                // `disabled:border-border`, and a plain `border-transparent` does NOT override a
                // `disabled:`-modified class in tailwind-merge. Without it, antd's chrome-less
                // text/link buttons grow a visible 1px box the moment they are disabled.
                ghost: "bg-transparent border-transparent text-foreground hover:bg-btn-text-hover-bg active:bg-btn-text-active-bg disabled:bg-transparent disabled:border-transparent",
                link: "bg-transparent border-transparent text-btn-link hover:text-btn-link-hover active:text-btn-link-active disabled:bg-transparent disabled:border-transparent",
                dashed: "border-dashed border-border bg-btn-default-bg text-foreground shadow-[0_2px_0_var(--ag-colorFillQuaternary)] hover:border-btn-primary-hover hover:text-btn-primary-hover active:bg-btn-default-active-bg active:border-btn-primary-active active:text-btn-primary-active disabled:bg-disabled-bg",
            },
            size: {
                sm: "h-control-sm px-btn-sm text-btn-sm rounded-control-sm",
                default: "h-control px-btn text-btn-md rounded-control",
                lg: "h-control-lg px-btn-lg text-btn-lg rounded-control-lg",
                // antd sizes an icon-ONLY button's glyph from `onlyIconSize`/`onlyIconSizeSM` (14px
                // both here), not the button's text ramp (button/style/index.js L136-140).
                icon: "h-control w-control p-0 text-[14px] rounded-control",
                "icon-sm": "h-control-sm w-control-sm p-0 text-[14px] rounded-control-sm",
            },
        },
        defaultVariants: {variant: "default", size: "default"},
    },
)

export interface ButtonProps
    extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

function Button({className, variant, size, asChild = false, ...props}: ButtonProps) {
    const Comp = asChild ? Slot : "button"
    return (
        <Comp
            data-slot="button"
            className={cn(buttonVariants({variant, size, className}))}
            {...props}
        />
    )
}

export {Button, buttonVariants}
