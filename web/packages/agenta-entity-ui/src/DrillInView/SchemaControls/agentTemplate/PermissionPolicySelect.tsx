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
    size?: "sm" | "default"
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
    size,
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
                        <span className="truncate">{selected?.title}</span>
                    </span>
                </SelectValue>
            </SelectTrigger>
            <SelectContent container={container}>
                {options.map((option) => (
                    <div key={option.value}>
                        {option.separatorBefore ? <SelectSeparator /> : null}
                        <SelectItem value={option.value} disabled={option.disabled}>
                            <span className="flex items-center gap-2.5 py-0.5">
                                {option.icon}
                                <span className="flex flex-col">
                                    <span>{option.title}</span>
                                    <span className="text-xs leading-snug text-colorTextTertiary">
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
