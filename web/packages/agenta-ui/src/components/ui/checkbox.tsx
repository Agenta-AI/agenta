import * as React from "react"

import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import {cva} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Checkbox — a Radix + cva primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on Root AND Indicator). Re-skinned to antd v6's Checkbox geometry via the shared
 * control scale (`size-control-check` = 16px, `rounded-control-sm` = 6px), colour via bridge tokens.
 *
 * SCOPE: the bare box only. antd's `Checkbox.Group` is NOT part of this primitive — compose it
 * if ever needed; no antd-shaped props are added.
 *
 * MARKS reproduce antd v6's `.ant-checkbox::after` exactly (measured), not lucide glyphs:
 *  - checked = a CSS rotated-border check (5.71×9.14, white 2px right+bottom borders, rotate 45°);
 *  - indeterminate = a small centred colorPrimary square on the white box (NOT a filled-primary box).
 * Both are absolutely positioned in the Root's padding box (Root is `relative`), like antd's ::after.
 *
 * antd → @agenta/ui mapping:
 *   <Checkbox checked defaultChecked onChange indeterminate disabled />
 *     → <Checkbox checked defaultChecked onCheckedChange checked="indeterminate" disabled />
 */

const checkboxVariants = cva([
    // CONTROL_RESET — Radix Root is a native <button>; preflight is off (see button.tsx).
    "box-border border-solid font-[inherit] p-0",
    "group relative inline-flex shrink-0 cursor-pointer items-center justify-center align-middle transition-colors",
    "size-control-check rounded-control-sm border", // antd: 16px box, borderRadiusSM=6px, 1px border.
    "bg-background border-border", // antd unchecked/indeterminate: colorBgContainer + colorBorder.
    "enabled:hover:border-primary", // antd hover border → colorPrimary (enabled only).
    // antd CHECKED (only): bg + border = colorPrimary. Indeterminate keeps the white box.
    "enabled:data-[state=checked]:bg-primary enabled:data-[state=checked]:border-primary",
    // checked + hover: antd repaints the box colorPrimaryHover with a transparent border.
    "enabled:data-[state=checked]:hover:bg-primary-hover enabled:data-[state=checked]:hover:border-transparent",
    // antd focus: shared 4px colorPrimaryBorder outline, 1px offset, :focus-visible only.
    "outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
    // antd disabled: colorBgContainerDisabled bg + colorBorder border, not-allowed (wins over checked).
    "disabled:cursor-not-allowed disabled:bg-colorBgContainerDisabled disabled:border-border",
])

export interface CheckboxProps extends React.ComponentProps<typeof CheckboxPrimitive.Root> {}

function Checkbox({className, ...props}: CheckboxProps) {
    return (
        <CheckboxPrimitive.Root
            data-slot="checkbox"
            className={cn(checkboxVariants(), className)}
            {...props}
        >
            <CheckboxPrimitive.Indicator
                data-slot="checkbox-indicator"
                className="pointer-events-none"
            >
                {/* CHECKED: antd's rotated-border check — 5.71×9.14 glyph metrics (measured literals),
                    white 2px right+bottom borders, rotate 45° translate(-50%,-50%) about centre,
                    anchored top 50% / left 3px of the padding box. 3px is antd v6's
                    `calc(checkboxSize/4 - lineWidth)` = 16/4-1; `left-1/4` resolves against the
                    14px padding box (3.5px) and shifted the tick half a pixel right of antd's.
                    colorTextDisabled when disabled. */}
                <span className="absolute left-[3px] top-1/2 box-border hidden h-[9.14px] w-[5.71px] border-2 border-l-0 border-t-0 border-solid border-colorWhite [transform:rotate(45deg)_translate(-50%,-50%)] group-disabled:border-colorTextDisabled group-data-[state=checked]:block" />
                {/* INDETERMINATE: centred colorPrimary square (antd v6 mark), 7px = control-check-dash. */}
                <span className="absolute left-1/2 top-1/2 hidden size-control-check-dash -translate-x-1/2 -translate-y-1/2 bg-primary group-data-[state=indeterminate]:block" />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    )
}

export {Checkbox, checkboxVariants}
