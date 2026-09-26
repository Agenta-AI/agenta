import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Input / Textarea — the shadcn input. Text is 16px below `md` so iOS Safari does not zoom the
 * page on focus. The ring uses `focus-within` so the affix wrapper in ./input-composed rings too.
 */
const inputVariants = cva(
    [
        "w-full min-w-0 border text-base text-foreground transition-colors outline-none md:text-sm",
        "placeholder:text-muted-foreground",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:disabled:bg-input/80",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
    ],
    {
        variants: {
            variant: {
                default:
                    "border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
                filled: "border-transparent bg-muted focus-within:border-ring focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/50",
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
            className={cn(inputVariants({variant, size}), "h-auto min-h-16 py-2", className)}
            {...props}
        />
    )
}

export {Input, Textarea, inputVariants}
