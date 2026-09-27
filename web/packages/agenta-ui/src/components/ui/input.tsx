import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

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
        "w-full min-w-0 border text-base text-foreground transition-colors outline-none md:text-sm",
        "placeholder:text-muted-foreground",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:disabled:bg-input/80",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-[3px] aria-[invalid=true]:ring-[color:color-mix(in_srgb,var(--ag-colorError)_20%,transparent)]",
        "dark:aria-[invalid=true]:border-[color:color-mix(in_srgb,var(--ag-colorError)_50%,transparent)] dark:aria-[invalid=true]:ring-[color:color-mix(in_srgb,var(--ag-colorError)_40%,transparent)]",
    ],
    {
        variants: {
            variant: {
                default:
                    "border-input bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-[color:var(--ag-controlOutline)] dark:bg-input/30",
                filled: "border-transparent bg-muted focus-within:border-ring focus-within:bg-background focus-within:ring-[3px] focus-within:ring-[color:var(--ag-controlOutline)]",
                ghost: "border-transparent bg-transparent",
            },
            size: {
                sm: "h-7 rounded-md px-2 py-0.5",
                default: "h-8 rounded-lg px-2.5 py-1",
                lg: "h-9 rounded-lg px-3 py-1.5",
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
