import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "../foundation/utils/cn"

/**
 * Input / Textarea — the shadcn input. Text is 16px below `md` so iOS Safari does not zoom the
 * page on focus. The ring uses `focus-within` so the affix wrapper in ./input-composed rings too.
 *
 * Every class here must compile under both apps: /w is Tailwind 3 with preflight off, /m is
 * Tailwind 4 with preflight on. So the control resets are explicit, and the ring width, ring
 * colors and the invalid variant use arbitrary values that both versions generate.
 */
const inputVariants = cva(
    [
        // CONTROL_RESET — see button.tsx. Without preflight (/w), `border` sets only the width,
        // an <input> keeps the UA font and a <textarea> keeps monospace.
        "box-border border-solid font-[inherit]",
        "w-full min-w-0 border text-field-md text-foreground transition-colors outline-none",
        "placeholder:text-muted-foreground",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-label file:text-foreground",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[color:color-mix(in_srgb,var(--border)_50%,transparent)] disabled:opacity-50 dark:disabled:bg-[color:color-mix(in_srgb,var(--border)_80%,transparent)]",
        "aria-[invalid=true]:border-destructive",
        "dark:aria-[invalid=true]:border-[color:color-mix(in_srgb,var(--destructive)_50%,transparent)]",
    ],
    {
        variants: {
            variant: {
                default:
                    "border-input bg-transparent focus-ring-field dark:bg-[color:color-mix(in_srgb,var(--border)_30%,transparent)]",
                filled: "border-transparent bg-muted focus-ring-field focus-within:bg-background",
                ghost: "border-transparent bg-transparent",
            },
            size: {
                // Heights read the control scale, so fields match buttons.
                sm: "h-control-sm rounded-control-sm px-2 py-0.5",
                default: "h-control rounded-control px-2.5 py-1",
                lg: "h-control-lg rounded-control-lg px-3 py-1.5",
                // Canvas form field and search field; touch.css makes text 16px on touch.
                compact: "h-control rounded-control px-2.5 py-0",
                "compact-search": "h-control-sm rounded-control px-2 py-0",
            },
        },
        defaultVariants: {variant: "default", size: "default"},
    },
)

export interface InputProps
    extends Omit<React.ComponentProps<"input">, "size">, VariantProps<typeof inputVariants> {}

function Input({className, variant, size, type, ...props}: InputProps) {
    return (
        <input
            type={type}
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
            className={cn(
                inputVariants({variant, size}),
                "h-auto min-h-16 resize-y py-2",
                className,
            )}
            {...props}
        />
    )
}

export {Input, Textarea, inputVariants}
