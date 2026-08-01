import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Input / Textarea — cva-styled native controls in @agenta/ui, following shadcn's source
 * conventions: no `forwardRef` (React 19 passes `ref` as a prop) and a `data-slot` attribute.
 *
 * antd-only features are NOT props here — they are compositions (the shadcn way):
 *   prefix/suffix + allowClear → `InputAffix` · Search/Password → `SearchInput`/
 *   `PasswordInput` · autoSize → `AutosizeTextarea`. All in ./input-composed.
 *
 * Geometry comes from the `control-*`/`input-*` theme scale, never raw pixels. Heights are
 * padding + line-height derived rather than fixed (antd's model — a fixed height diverges
 * as soon as font-size changes); `ghost` adds 1px of vertical padding to compensate for
 * its missing border so the totals line up.
 */
const inputVariants = cva(
    [
        // CONTROL_RESET — see button.tsx. Preflight is off app-wide for antd's sake, so a
        // bare <input> keeps the UA font (Arial) and a <textarea> keeps monospace.
        "box-border border-solid font-[inherit]",
        "w-full border text-foreground outline-none transition-colors",
        "placeholder:text-placeholder",
        "disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled disabled:border-disabled-border",
        // Error border must survive focus (antd keeps it red, not primary — the `!` beats the
        // variant's focus border), + red focus glow. `focus-within` (not `focus`) so the glow
        // ALSO fires on the affix wrapper (a span) when its inner <input> is focused — antd's
        // `.ant-input-affix-wrapper:focus-within`. On a bare <input> it behaves like `:focus`.
        "aria-[invalid=true]:border-error aria-[invalid=true]:focus-within:!border-error aria-[invalid=true]:focus-within:shadow-[0_0_0_2px_var(--ag-errorOutline)]",
    ],
    {
        variants: {
            variant: {
                default:
                    "bg-background border-border hover:border-btn-primary-hover focus-within:border-primary focus-within:shadow-[0_0_0_2px_var(--ag-controlOutline)]",
                // antd's filled input has NO focus glow (only the outlined `default` does).
                filled: "bg-muted border-transparent hover:bg-secondary focus-within:bg-background focus-within:border-primary",
                ghost: "bg-transparent border-0",
            },
            size: {
                sm: "text-field-sm px-input-sm rounded-control-sm",
                default: "text-field-md px-input rounded-control",
                lg: "text-field-lg px-input-lg rounded-control-lg",
            },
        },
        compoundVariants: [
            {variant: ["default", "filled"], size: "sm", className: "py-input-y-sm"},
            {variant: ["default", "filled"], size: "default", className: "py-input-y"},
            {variant: ["default", "filled"], size: "lg", className: "py-input-y-lg"},
            {variant: "ghost", size: "sm", className: "py-input-y-ghost-sm"},
            {variant: "ghost", size: "default", className: "py-input-y-ghost"},
            {variant: "ghost", size: "lg", className: "py-input-y-ghost-lg"},
        ],
        defaultVariants: {variant: "default", size: "default"},
    },
)

export interface InputProps
    extends Omit<React.ComponentProps<"input">, "size">, VariantProps<typeof inputVariants> {}

function Input({className, variant, size, ...props}: InputProps) {
    return (
        <input
            data-slot="input"
            className={cn(inputVariants({variant, size}), className)}
            {...props}
        />
    )
}

export interface TextareaProps
    extends Omit<React.ComponentProps<"textarea">, "size">, VariantProps<typeof inputVariants> {}

function Textarea({className, variant, size, rows = 3, ...props}: TextareaProps) {
    return (
        <textarea
            data-slot="textarea"
            rows={rows}
            // align-bottom = antd's `vertical-align: bottom` — kills the inline descender gap under the box.
            className={cn(inputVariants({variant, size}), "py-input-y align-bottom", className)}
            {...props}
        />
    )
}

export {Input, Textarea, inputVariants}
