/**
 * PermissionPolicySelect — `runner.permissions.default`: what the agent may do on its own.
 *
 * Replaces antd `Select optionLabelProp="title"` (two-line options in the dropdown, the bare
 * label in the trigger). Radix's `SelectValue` renders the selected item's text by default, so
 * the trigger label is passed explicitly — that IS `optionLabelProp`.
 */
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"

export interface PermissionPolicyOption {
    value: string
    /** Trigger label (antd's `optionLabelProp="title"`). */
    title: string
    /** Second line in the dropdown row. */
    help: string
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
            <SelectTrigger className="w-full" aria-label={ariaLabel}>
                <SelectValue>{selected?.title}</SelectValue>
            </SelectTrigger>
            <SelectContent container={container}>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        <span className="flex flex-col py-0.5">
                            <span>{option.title}</span>
                            <span className="text-xs leading-snug text-colorTextTertiary">
                                {option.help}
                            </span>
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

export default PermissionPolicySelect
