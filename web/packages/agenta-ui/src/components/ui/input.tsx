import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Input / Textarea — the shadcn input, sized off the `control-*`/`input-*` scale. The focus ring
 * is a box-shadow on `focus-within` so the affix wrapper rings too; antd's prefix/suffix/search/
 * password/autoSize are compositions in ./input-composed.
 */
const inputVariants = cva(
    [
        // CONTROL_RESET — see button.tsx. Preflight is off app-wide for antd's sake, so a
        // bare <input> keeps the UA font (Arial) and a <textarea> keeps monospace.
        "box-border border-solid font-[inherit]",
        "w-full border text-foreground outline-none transition-[color,box-shadow,border-color]",
        "placeholder:text-placeholder",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Invalid: red border + 3px red ring, focused or not; `!` keeps the border red on focus.
        "aria-[invalid=true]:border-error aria-[invalid=true]:focus-within:!border-error aria-[invalid=true]:shadow-[0_0_0_3px_var(--ag-errorOutline)]",
    ],
    {
        variants: {
            variant: {
                default:
                    "bg-background border-border focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--ag-controlOutline)]",
                filled: "bg-muted border-transparent focus-within:bg-background focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--ag-controlOutline)]",
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
            // resize-y: preflight is off, so the UA default `resize: both` drags out of the container.
            className={cn(
                inputVariants({variant, size}),
                "py-input-y align-bottom resize-y",
                className,
            )}
            {...props}
        />
    )
}

export {Input, Textarea, inputVariants}
