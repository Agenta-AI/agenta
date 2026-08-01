import * as React from "react"

import {Info} from "@phosphor-icons/react"
import {cva, type VariantProps} from "class-variance-authority"

import {Label} from "./label"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "./tooltip"
import {cn} from "./utils"

/**
 * Field — the label-over-control consolidation primitive in @agenta/ui, following shadcn's
 * source conventions (no `forwardRef`, `data-slot` on every part). It replaces the three
 * hand-rolled wrappers this package shipped: `LabeledField` (label + info-tooltip + layout),
 * `LabelInput` (label + required asterisk), and the label side of form rows.
 *
 * Composition, not props-soup: it renders the package's own `Label` + `Tooltip`. A label sits
 * above (vertical) or beside (horizontal) a control SLOT (`children`), with an optional
 * required asterisk, an info tooltip, a description under the label, and an error/help line
 * under the control.
 *
 * Accessibility: the label associates with its control via `htmlFor`. If no `htmlFor` is given
 * and the single child has no `id`, Field generates one (`useId`) and injects it into the
 * child, so the association is automatic and axe stays clean.
 *
 * Parity target is the current `LabeledField` rendering: label `font-medium` + `text-foreground`
 * (colorText), 12px at the default size, 4px gap to the control; asterisk `text-error`
 * (colorError); info icon in `colorTextDescription`; description in `colorTextDescription`.
 * Colour/geometry come from tokens — no raw hex, no raw px (bar the noted icon size).
 */

// Label typography by size — mirrors LabeledField's xs/sm/md → text-xs/text-sm/text-base ramp.
const fieldLabelVariants = cva("font-medium", {
    variants: {
        size: {
            xs: "text-xs",
            sm: "text-sm",
            md: "text-base",
        },
    },
    defaultVariants: {size: "xs"},
})

// Outer gap (vertical direction) — mirrors LabeledField's gap="xs"|"sm"|"md" → gap-1/2/3.
const GAP_CLASS = {
    xs: "gap-1",
    sm: "gap-2",
    md: "gap-3",
} as const

export interface FieldProps extends VariantProps<typeof fieldLabelVariants> {
    /** Field label. Rendered inside a `<label>` associated with the control. */
    label?: React.ReactNode
    /** Appends a `colorError` asterisk after the label. */
    required?: boolean
    /** Info tooltip shown on a small icon beside the label (was LabeledField's `description`). */
    tooltip?: React.ReactNode
    /** Side the tooltip opens on. Mirrors LabeledField's `tooltipPlacement`. Defaults to `right`. */
    tooltipPlacement?: "top" | "right" | "bottom" | "left"
    /** Help text under the label, in `colorTextDescription`. */
    description?: React.ReactNode
    /** Error / help line under the control, in `colorError`. */
    error?: React.ReactNode
    /** Layout direction. `vertical` (default) stacks; `horizontal` puts the label beside the control. */
    direction?: "vertical" | "horizontal"
    /**
     * Boxed layout (was `LabelInput`): wraps the label + control in a bordered container with the
     * label inside, for compact credential-style fields. Expects a borderless (ghost) control.
     * Vertical only.
     */
    boxed?: boolean
    /** Gap between label block and control (vertical only). Defaults to `xs` (4px). */
    gap?: keyof typeof GAP_CLASS
    /** Associates the label with the control. Omit to auto-generate + inject an id into the child. */
    htmlFor?: string
    /** Marks the field disabled (dims the label via `data-disabled`). Does not disable the control. */
    disabled?: boolean
    /** The control. */
    children: React.ReactNode
    className?: string
}

function Field({
    label,
    required = false,
    tooltip,
    tooltipPlacement = "right",
    description,
    error,
    direction = "vertical",
    gap = "xs",
    size,
    htmlFor,
    disabled = false,
    boxed = false,
    children,
    className,
}: FieldProps) {
    const autoId = React.useId()
    const child = React.isValidElement<{id?: string}>(children) ? children : null
    const childId = child?.props.id
    // Only claim an id we can guarantee exists on a control, so `htmlFor` is never dangling.
    const controlId = htmlFor ?? childId ?? (child ? autoId : undefined)
    const control =
        child && !htmlFor && !childId ? React.cloneElement(child, {id: controlId}) : children

    const isHorizontal = direction === "horizontal"

    const header = (label != null || description != null) && (
        <div data-slot="field-header" className="flex flex-col gap-0.5">
            {label != null && (
                <div data-slot="field-label-row" className="flex items-center gap-1">
                    <Label
                        htmlFor={controlId}
                        data-slot="field-label"
                        className={cn(fieldLabelVariants({size}), isHorizontal && "flex-shrink-0")}
                    >
                        <span data-slot="field-label-text">
                            {label}
                            {required && (
                                <span
                                    data-slot="field-required"
                                    aria-hidden="true"
                                    className="ml-0.5 text-error"
                                >
                                    *
                                </span>
                            )}
                        </span>
                    </Label>
                    {tooltip != null && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        data-slot="field-tooltip-trigger"
                                        aria-label="More information"
                                        className="box-border inline-flex cursor-help border-0 bg-transparent p-0 font-[inherit] text-colorTextDescription"
                                    >
                                        <Info className="size-3" aria-hidden="true" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side={tooltipPlacement}>{tooltip}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
            )}
            {description != null && (
                <span data-slot="field-description" className="text-xs text-colorTextDescription">
                    {description}
                </span>
            )}
        </div>
    )

    const errorLine = error != null && (
        <span data-slot="field-error" className="text-xs text-error">
            {error}
        </span>
    )

    if (isHorizontal) {
        return (
            <div
                data-slot="field"
                data-disabled={disabled || undefined}
                className={cn("flex items-center gap-2", className)}
            >
                {header}
                <div data-slot="field-control" className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {control}
                    {errorLine}
                </div>
            </div>
        )
    }

    return (
        <div
            data-slot="field"
            data-disabled={disabled || undefined}
            className={cn(
                "flex flex-col",
                boxed
                    ? "gap-0 rounded-lg border border-solid border-border p-1 pl-2.5"
                    : GAP_CLASS[gap],
                className,
            )}
        >
            {header}
            {control}
            {errorLine}
        </div>
    )
}

export {Field, fieldLabelVariants}
