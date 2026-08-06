import * as React from "react"

import * as SelectPrimitive from "@radix-ui/react-select"
import {cva, type VariantProps} from "class-variance-authority"
import {Check, ChevronDown, ChevronUp} from "lucide-react"

import {cn} from "./utils"

/**
 * Select — a Radix + cva primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). Re-skinned to antd's geometry via the shared control scale, so the
 * trigger is dimensionally identical to Input (antd gives both h28/px11/r8/12px).
 *
 * SCOPE: single-select only, which is all this codebase uses — there is no `mode="multiple"`
 * or `mode="tags"` anywhere in @agenta/ui. Radix Select is single-select by design; if a
 * multi-select is ever needed it is a Combobox (searchable select), not a prop on this.
 *
 * Searchable selects (antd `showSearch`) are also a Combobox, not this component.
 *
 * antd → @agenta/ui mapping:
 *   <Select options={[{value,label}]} value onChange />
 *     → <Select value onValueChange><SelectTrigger><SelectValue/></SelectTrigger>
 *       <SelectContent><SelectItem value=…>label</SelectItem></SelectContent></Select>
 *   size small/middle/large → sm/default/lg · variant borderless → ghost
 *   allowClear → no equivalent (add an explicit "none" item, or use a Combobox)
 */

const selectTriggerVariants = cva(
    [
        // CONTROL_RESET — see button.tsx (preflight is off app-wide for antd's sake).
        "box-border border-solid font-[inherit]",
        "flex w-full items-center justify-between gap-1 border text-foreground outline-none transition-colors",
        "cursor-pointer disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled disabled:border-disabled-border",
        // antd greys only the placeholder TEXT; the root keeps the foreground colour.
        "[&[data-placeholder]_[data-slot=select-value]]:text-placeholder",
        // antd's error state colours the border AND the text/arrow/placeholder, + red focus glow.
        "aria-[invalid=true]:border-error aria-[invalid=true]:text-error aria-[invalid=true]:focus:shadow-[0_0_0_2px_var(--ag-errorOutline)] aria-[invalid=true]:data-[state=open]:shadow-[0_0_0_2px_var(--ag-errorOutline)]",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    ],
    {
        variants: {
            variant: {
                // Focus glow (antd controlOutline) on: Radix Select button (focus / data-open)
                // AND the Combobox div-trigger (has a focused input inside).
                default:
                    "bg-background border-border hover:border-btn-primary-hover focus:border-primary data-[state=open]:border-primary focus:shadow-[0_0_0_2px_var(--ag-controlOutline)] data-[state=open]:shadow-[0_0_0_2px_var(--ag-controlOutline)] [&:has(:focus)]:border-primary [&:has(:focus)]:shadow-[0_0_0_2px_var(--ag-controlOutline)]",
                filled: "bg-muted border-transparent hover:bg-secondary focus:bg-background focus:border-primary focus:shadow-[0_0_0_2px_var(--ag-controlOutline)] data-[state=open]:shadow-[0_0_0_2px_var(--ag-controlOutline)] [&:has(:focus)]:shadow-[0_0_0_2px_var(--ag-controlOutline)]",
                // Transparent, not `border-0`: antd keeps a 1px transparent border so the
                // content box stays identical to the outlined variant.
                ghost: "bg-transparent border-transparent",
            },
            size: {
                // antd's small Select keeps the default height and type ramp and only
                // tightens padding — unlike its small Input (h24/10px). Measured, not assumed.
                sm: "h-control px-input-sm text-field-md rounded-control-sm",
                default: "h-control px-input text-field-md rounded-control",
                lg: "h-control-lg px-input-lg text-field-lg rounded-control-lg",
            },
        },
        defaultVariants: {variant: "default", size: "default"},
    },
)

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
    return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
    return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
    return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

export interface SelectTriggerProps
    extends
        Omit<React.ComponentProps<typeof SelectPrimitive.Trigger>, "size">,
        VariantProps<typeof selectTriggerVariants> {}

function SelectTrigger({className, variant, size, children, ...props}: SelectTriggerProps) {
    return (
        <SelectPrimitive.Trigger
            data-slot="select-trigger"
            className={cn(selectTriggerVariants({variant, size}), className)}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon asChild>
                <ChevronDown className="size-3 text-placeholder" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    )
}

function SelectContent({
    className,
    children,
    position = "popper",
    container,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass an element to render inline. */
    container?: HTMLElement | null
}) {
    return (
        <SelectPrimitive.Portal container={container}>
            <SelectPrimitive.Content
                data-slot="select-content"
                position={position}
                className={cn(
                    // font-portal: this content portals to <body>, escaping the app font scope.
                    // antd `.ant-select-dropdown` is borderless with the overlay shadow (boxShadowSecondary)
                    // and borderRadiusLG (10px) — NOT a bordered shadcn panel.
                    // box-border: preflight is off, so width must include the p-1 padding
                    // (else the panel renders 8px wider than the trigger / antd dropdown).
                    "relative z-50 box-border max-h-96 min-w-[8rem] overflow-hidden bg-popover text-popover-foreground shadow-overlay font-portal",
                    "rounded-control-lg p-1",
                    // Pin the panel to the trigger width (antd matches dropdown to trigger). With
                    // box-border the border-box equals the trigger width; the p-1 padding stays inside.
                    position === "popper" &&
                        "w-[var(--radix-select-trigger-width)] data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
                    className,
                )}
                {...props}
            >
                <SelectScrollUpButton />
                <SelectPrimitive.Viewport
                    className={cn(
                        // w-full fills the padded inner box; the panel width is pinned on Content,
                        // so DON'T re-force min-w to the trigger width here (that re-adds the padding).
                        position === "popper" && "h-[var(--radix-select-trigger-height)] w-full",
                    )}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectScrollDownButton />
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    )
}

function SelectLabel({className, ...props}: React.ComponentProps<typeof SelectPrimitive.Label>) {
    return (
        <SelectPrimitive.Label
            data-slot="select-label"
            className={cn("px-input-sm py-input-y-sm text-field-sm text-placeholder", className)}
            {...props}
        />
    )
}

function SelectItem({
    className,
    children,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
    return (
        <SelectPrimitive.Item
            data-slot="select-item"
            className={cn(
                "relative flex w-full cursor-pointer select-none items-center justify-between gap-2 outline-none",
                // antd option geometry: min-h 28px, 4px×12px padding, 6px radius, selected weight 600.
                "box-border min-h-control rounded-control-sm px-3 py-1 text-field-md",
                // antd colours: highlighted-but-not-selected = controlItemBgHover; selected =
                // controlItemBgActive (a cool bluish tint, not the neutral accent gray). The
                // `:not()` keeps the selected row's active bg from being overridden by hover.
                "[&[data-highlighted]:not([data-state=checked])]:bg-muted",
                "data-[state=checked]:bg-controlItemBgActive data-[state=checked]:font-semibold",
                "data-[disabled]:pointer-events-none data-[disabled]:text-disabled",
                className,
            )}
            {...props}
        >
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
            {/* DELIBERATE deviation from antd v6 (documented): antd v6 dropped the default
                selected-check (the .ant-select-item-option-state span is empty, width 0) that v5
                had. We keep the check as an explicit affordance — sits where antd reserves the
                state slot (right side), colorPrimary. See Select.md §Deliberate deviations. */}
            <SelectPrimitive.ItemIndicator asChild>
                <Check className="size-3 shrink-0 text-primary" />
            </SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
    )
}

function SelectSeparator({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
    return (
        <SelectPrimitive.Separator
            data-slot="select-separator"
            // Matches the antd menu divider: 1px colorSplit, `marginXXS 0`, inset by the p-1.
            className={cn("my-1 h-px bg-colorSplit", className)}
            {...props}
        />
    )
}

function SelectScrollUpButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
    return (
        <SelectPrimitive.ScrollUpButton
            data-slot="select-scroll-up-button"
            className={cn("flex cursor-default items-center justify-center py-1", className)}
            {...props}
        >
            <ChevronUp className="size-3" />
        </SelectPrimitive.ScrollUpButton>
    )
}

function SelectScrollDownButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
    return (
        <SelectPrimitive.ScrollDownButton
            data-slot="select-scroll-down-button"
            className={cn("flex cursor-default items-center justify-center py-1", className)}
            {...props}
        >
            <ChevronDown className="size-3" />
        </SelectPrimitive.ScrollDownButton>
    )
}

export {
    Select,
    SelectGroup,
    SelectValue,
    SelectTrigger,
    SelectContent,
    SelectLabel,
    SelectItem,
    SelectSeparator,
    SelectScrollUpButton,
    SelectScrollDownButton,
    selectTriggerVariants,
}
