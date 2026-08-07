import * as React from "react"

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import {cva} from "class-variance-authority"

import {cn} from "./utils"

/**
 * RadioGroup — a Radix + cva primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on Root/Item/Indicator). Re-skinned to antd's Radio geometry via the shared
 * control scale (`size-control-check` circle, `size-control-dot` dot), colour via bridge
 * tokens only. Single size — antd has no small radio.
 *
 * SCOPE: the bare radio only. antd's `Radio.Button` (segmented pill group) is a SEPARATE
 * future component (Segmented), NOT this. No antd-shaped props are added.
 *
 * antd → @agenta/ui mapping:
 *   <Radio.Group value onChange options> → <RadioGroup value onValueChange><RadioGroupItem/>…
 *   <Radio value disabled>               → <RadioGroupItem value disabled/>
 */

const radioItemVariants = cva([
    // CONTROL_RESET — preflight is off app-wide (antd ships its own reset); see button.tsx.
    "box-border border-solid font-[inherit] p-0",
    // antd radio circle: 16px, 1px border colorBorder, bg colorBgContainer.
    "size-control-check shrink-0 rounded-full border bg-background border-border",
    "inline-flex items-center justify-center cursor-pointer transition-colors",
    // hover (enabled): border → colorPrimary.
    "enabled:hover:border-primary",
    // checked (antd v6): circle FILLED colorPrimary + colorPrimary border (dot is white — Indicator).
    "enabled:data-[state=checked]:border-primary enabled:data-[state=checked]:bg-primary",
    // checked + hover: antd repaints the whole disc colorPrimaryHover and makes the border
    // transparent (the bg shows through the border box), so the 1px rim moves with the fill.
    "enabled:data-[state=checked]:hover:bg-primary-hover enabled:data-[state=checked]:hover:border-transparent",
    // focus (antd shared 4px focus outline): :focus-visible only, 1px offset.
    "outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
    // disabled: bg colorBgContainerDisabled, border colorBorder (reverts even when checked; `enabled:` gates checked above).
    "disabled:cursor-not-allowed disabled:bg-colorBgContainerDisabled disabled:border-colorBorder",
])

export type RadioGroupProps = React.ComponentProps<typeof RadioGroupPrimitive.Root>

function RadioGroup({className, ...props}: RadioGroupProps) {
    return (
        <RadioGroupPrimitive.Root
            data-slot="radio-group"
            className={cn("flex flex-col gap-2", className)}
            {...props}
        />
    )
}

function RadioGroupItem({
    className,
    ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
    return (
        <RadioGroupPrimitive.Item
            data-slot="radio-group-item"
            className={cn(radioItemVariants(), className)}
            {...props}
        >
            <RadioGroupPrimitive.Indicator
                data-slot="radio-group-indicator"
                // antd v6 centered dot: white (colorTextLightSolid) on the filled circle; → colorTextDisabled when disabled.
                className="size-control-dot rounded-full bg-primary-foreground [[data-slot=radio-group-item]:disabled_&]:bg-colorTextDisabled"
            />
        </RadioGroupPrimitive.Item>
    )
}

export {RadioGroup, RadioGroupItem}
