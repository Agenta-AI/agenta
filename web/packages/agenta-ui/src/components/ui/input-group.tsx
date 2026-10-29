"use client"

/**
 * shadcn `input-group`, installed and then owned (minus `InputGroupTextarea`, unused here).
 */
import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {Button} from "./button"
import {Input, type InputProps} from "./input"
import {cn} from "./utils"

function InputGroup({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="input-group"
            role="group"
            className={cn(
                // box-border + border-solid: preflight is off app-wide.
                "group/input-group box-border border-solid border-input bg-background relative flex w-full min-w-0 items-center rounded-control border outline-none transition-[color,box-shadow,border-color]",
                "h-control has-[>textarea]:h-auto",
                "has-[:disabled]:opacity-50",

                // Inner gutters next to an addon.
                "has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
                "has-[>[data-align=inline-end]]:[&>input]:pr-1.5",
                "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3",
                "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3",

                // The group wears the same 3px ring a bare Input does.
                "has-[[data-slot=input-group-control]:focus-within]:border-ring",
                "has-[[data-slot=input-group-control]:focus-within]:shadow-[0_0_0_3px_var(--ag-controlOutline)]",

                // Error state: red border + 3px red ring.
                "has-[[data-slot][aria-invalid=true]]:border-error has-[[data-slot][aria-invalid=true]]:shadow-[0_0_0_3px_var(--ag-errorOutline)]",

                className,
            )}
            {...props}
        />
    )
}

const inputGroupAddonVariants = cva(
    "text-muted-foreground flex h-auto cursor-text select-none items-center justify-center gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
    {
        variants: {
            align: {
                "inline-start":
                    "order-first pl-2 has-[>button]:ml-[-0.3rem] has-[>kbd]:ml-[-0.15rem]",
                "inline-end": "order-last pr-2 has-[>button]:mr-[-0.3rem] has-[>kbd]:mr-[-0.15rem]",
                "block-start":
                    "[.border-b]:pb-3 order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-2.5",
                "block-end":
                    "[.border-t]:pt-3 order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-2.5",
            },
        },
        defaultVariants: {
            align: "inline-start",
        },
    },
)

function InputGroupAddon({
    className,
    align = "inline-start",
    ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
    return (
        <div
            role="group"
            data-slot="input-group-addon"
            data-align={align}
            className={cn(inputGroupAddonVariants({align}), className)}
            onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) {
                    return
                }
                e.currentTarget.parentElement?.querySelector("input")?.focus()
            }}
            {...props}
        />
    )
}

const inputGroupButtonVariants = cva("flex items-center gap-2 text-sm shadow-none", {
    variants: {
        size: {
            xs: "h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
            sm: "h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5",
            "icon-xs": "size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0",
            "icon-sm": "size-8 p-0 has-[>svg]:p-0",
        },
    },
    defaultVariants: {
        size: "xs",
    },
})

function InputGroupButton({
    className,
    type = "button",
    variant = "ghost",
    size = "xs",
    ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
    VariantProps<typeof inputGroupButtonVariants>) {
    return (
        <Button
            type={type}
            data-size={size}
            variant={variant}
            className={cn(inputGroupButtonVariants({size}), className)}
            {...props}
        />
    )
}

function InputGroupText({className, ...props}: React.ComponentProps<"span">) {
    return (
        <span
            className={cn(
                "text-muted-foreground flex items-center gap-2 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
                className,
            )}
            {...props}
        />
    )
}

/**
 * Typed against this package's `Input`, not the raw element: `size` here is the variant
 * ("sm" | "default" | "lg"), which is not the native input's numeric `size`.
 */
function InputGroupInput({className, ...props}: InputProps) {
    return (
        <Input
            data-slot="input-group-control"
            className={cn(
                "flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
                // No focus chrome of its own: the group rings instead.
                "focus-within:border-0 focus-within:shadow-none focus-visible:shadow-none",
                className,
            )}
            {...props}
        />
    )
}

export {InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput}
