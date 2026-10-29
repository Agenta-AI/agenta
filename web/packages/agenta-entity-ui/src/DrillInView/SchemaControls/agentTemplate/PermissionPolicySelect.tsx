/**
 * PermissionPolicySelect — `runner.permissions.default`: what the agent may do on its own.
 *
 * Replaces antd `Select optionLabelProp="title"` (two-line options in the dropdown, the bare
 * label in the trigger). Radix's `SelectValue` renders the selected item's text by default, so
 * the trigger label is passed explicitly — that IS `optionLabelProp`.
 */
import type {ReactNode} from "react"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"

export interface PermissionPolicyOption {
    value: string
    /** Trigger label (antd's `optionLabelProp="title"`). */
    title: string
    /** Second line in the dropdown row. */
    help: string
    /** Glyph before the label, in the trigger and in the menu row. Omit for a text-only option. */
    icon?: ReactNode
    /** Draw a divider above this option (the integration drawer sets it on "Custom"). */
    separatorBefore?: boolean
    /** Shown, and shown as the current value, but not pickable — a derived state such as
     *  "Custom", which an author reaches by setting a per-tool value rather than by choosing it. */
    disabled?: boolean
}

export interface PermissionPolicySelectProps {
    value: string
    onChange: (value: string) => void
    options: PermissionPolicyOption[]
    disabled?: boolean
    "aria-label"?: string
    /** Controlled open state (the forced-open parity story drives this). */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** Portal target for the dropdown — e.g. a scroll container, or a story comparing panels. */
    container?: HTMLElement | null
    /** Trigger sizing/colour override — the drawer's per-tool select is a compact inline chip. */
    triggerClassName?: string
    /** Menu width override. The panel is pinned to the trigger, which wraps a compact chip's rows. */
    contentClassName?: string
    /**
     * What the TRIGGER says, where that differs from what the menu calls the selected value. An
     * MCP tool row names the value in the menu ("Follow agent policy") and says what the run will
     * do with it at rest ("Inherits ask"), so a row never shows a bare value with no provenance.
     */
    triggerTitle?: string
    size?: "sm" | "default"
    /** Which trigger edge the menu lines up with. A row's trailing chip opens leftward ("end"). */
    align?: "start" | "end"
}

export function PermissionPolicySelect({
    value,
    onChange,
    options,
    disabled,
    "aria-label": ariaLabel = "Permission policy",
    open,
    onOpenChange,
    container,
    triggerClassName = "w-full",
    contentClassName,
    triggerTitle,
    size,
    align,
}: PermissionPolicySelectProps) {
    const selected = options.find((option) => option.value === value)
    return (
        <Select
            value={value}
            onValueChange={onChange}
            disabled={disabled}
            open={open}
            onOpenChange={onOpenChange}
        >
            <SelectTrigger className={triggerClassName} size={size} aria-label={ariaLabel}>
                <SelectValue>
                    <span className="flex min-w-0 items-center gap-2">
                        {selected?.icon}
                        <span className="truncate">{triggerTitle ?? selected?.title}</span>
                    </span>
                </SelectValue>
            </SelectTrigger>
            <SelectContent container={container} className={contentClassName} align={align}>
                {options.map((option) => (
                    <div key={option.value}>
                        {option.separatorBefore ? <SelectSeparator /> : null}
                        <SelectItem
                            value={option.value}
                            disabled={option.disabled}
                            // Neutral rows: hover and the picked row share the accent wash, and the
                            // check alone marks the value. The check sits on the title line.
                            className="items-start px-2 py-1.5 data-[state=checked]:bg-transparent data-[state=checked]:font-normal data-[highlighted]:data-[state=checked]:bg-accent [&[data-highlighted]:not([data-state=checked])]:bg-accent [&>svg]:mt-1 [&>svg]:text-foreground"
                        >
                            <span className="flex items-start gap-2.5">
                                {option.icon ? (
                                    <span className="mt-[3px] flex shrink-0 text-colorTextSecondary">
                                        {option.icon}
                                    </span>
                                ) : null}
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="whitespace-nowrap font-medium max-sm:text-xs">
                                        {option.title}
                                    </span>
                                    <span className="text-xs leading-snug text-colorTextTertiary max-sm:text-[11px]">
                                        {option.help}
                                    </span>
                                </span>
                            </span>
                        </SelectItem>
                    </div>
                ))}
            </SelectContent>
        </Select>
    )
}

export default PermissionPolicySelect
