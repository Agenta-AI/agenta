import * as React from "react"

import * as SwitchPrimitive from "@radix-ui/react-switch"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Switch — a Radix + cva primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on Root AND Thumb). Re-skinned to antd's Switch geometry via the shared
 * control scale (`h-switch`/`w-switch`/`size-switch-thumb`). Dimensions come from tokens; the thumb
 * TRAVEL is literal px because it must resolve under Tailwind v3 and v4 alike (see the variants).
 *
 * SCOPE: the bare toggle only. antd's `loading` (spinner in the handle) and rich checked/
 * unchecked labels are NOT part of this primitive — compose them if ever needed. No
 * antd-shaped props are added.
 *
 * antd → @agenta/ui mapping:
 *   <Switch checked defaultChecked onChange disabled size="small" />
 *     → <Switch checked defaultChecked onCheckedChange disabled size="sm" />
 */

const switchVariants = cva(
    [
        // CONTROL_RESET — preflight is off app-wide (antd ships its own reset); see button.tsx.
        "box-border border-0 font-[inherit]",
        "inline-flex shrink-0 cursor-pointer select-none items-center rounded-full align-middle transition-colors",
        "p-[2px]", // antd trackPadding: 2px inset the thumb sits within (theme-invariant literal).
        // antd track: unchecked=colorTextQuaternary, checked=colorPrimary.
        "data-[state=unchecked]:bg-colorTextQuaternary data-[state=checked]:bg-primary",
        // antd hover (only when enabled): unchecked=colorTextTertiary, checked=colorPrimaryHover.
        "enabled:hover:data-[state=unchecked]:bg-colorTextTertiary enabled:hover:data-[state=checked]:bg-btn-primary-hover",
        // antd focus (lineWidthFocus=4): 4px solid colorPrimaryBorder outline, 1px offset, :focus-visible only.
        "outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
        // antd disabled: opacityLoading (0.65) + not-allowed; handle shadow removed.
        "disabled:cursor-not-allowed disabled:opacity-[0.65] disabled:[&_[data-slot=switch-thumb]]:shadow-none",
    ],
    {
        variants: {
            size: {
                // antd press-stretch (switchHandleActiveInset -30%): on root :active the handle
                // grows 30% toward the press-opposite side — unchecked grows right (anchor left,
                // translate stays 0), checked grows left (anchor right, so shrink the travel by
                // 0.3×thumb). Keyed on the ROOT's :active applied to the thumb (antd's mechanism).
                // Literal px, not theme()/translate-x-*: v4 (web/mobile) resolves neither, so the
                // composed transform computed to `none` there. Values track controlScale.ts.
                default: [
                    "h-switch w-switch",
                    // 18 × 1.3
                    "active:data-[state=unchecked]:[&_[data-slot=switch-thumb]]:w-[23.4px]",
                    "active:data-[state=checked]:[&_[data-slot=switch-thumb]]:w-[23.4px]",
                    // 44 − 18 − 4 − 18×0.3
                    "active:data-[state=checked]:[&_[data-slot=switch-thumb]]:[transform:translateX(16.6px)]",
                ],
                sm: [
                    "h-switch-sm w-switch-sm",
                    // 12 × 1.3
                    "active:data-[state=unchecked]:[&_[data-slot=switch-thumb]]:w-[15.6px]",
                    "active:data-[state=checked]:[&_[data-slot=switch-thumb]]:w-[15.6px]",
                    // 28 − 12 − 4 − 12×0.3
                    "active:data-[state=checked]:[&_[data-slot=switch-thumb]]:[transform:translateX(8.4px)]",
                ],
            },
        },
        defaultVariants: {size: "default"},
    },
)

const switchThumbVariants = cva(
    [
        "pointer-events-none block rounded-full bg-white",
        // antd handle shadow (`handleShadow`, theme-invariant) — `switch-handle` bridge token.
        "shadow-switch-handle",
        "transition-transform data-[state=unchecked]:[transform:translateX(0)]",
    ],
    {
        variants: {
            size: {
                // travel = trackWidth − thumb − 2×trackPadding(2px) → 44−18−4=22 / 28−12−4=12.
                // Literal px + arbitrary `transform` — see the root variants for why not theme().
                default: "size-switch-thumb data-[state=checked]:[transform:translateX(22px)]",
                sm: "size-switch-thumb-sm data-[state=checked]:[transform:translateX(12px)]",
            },
        },
        defaultVariants: {size: "default"},
    },
)

export interface SwitchProps
    extends
        Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "size">,
        VariantProps<typeof switchVariants> {}

function Switch({className, size, ...props}: SwitchProps) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(switchVariants({size}), className)}
            {...props}
        >
            <SwitchPrimitive.Thumb
                data-slot="switch-thumb"
                className={cn(switchThumbVariants({size}))}
            />
        </SwitchPrimitive.Root>
    )
}

export {Switch, switchVariants}
