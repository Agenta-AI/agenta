/**
 * Composed controls for the model / fallback / retry configure popover. They cover the three
 * antd behaviours the `@agenta/ui` primitives deliberately dropped:
 *
 * - `Select allowClear` — Radix has no clear affordance; `""` is the "no selection" sentinel
 *   and the hover clear button mirrors the shared gatewayTool `SelectControl`.
 * - `Select optionRender` — the right-aligned per-option description. antd renders it in the
 *   DROPDOWN only, so it is hidden inside the trigger's value node (Radix renders the same
 *   node in both places).
 * - `Tooltip title={cond ? msg : undefined}` — antd renders no tooltip for an undefined title;
 *   Radix always builds one, so the hint-less case returns the child bare.
 */
import type {ReactElement, ReactNode} from "react"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    type SelectTriggerProps,
} from "@agenta/ui/ui"
import {XCircle} from "@phosphor-icons/react"

export interface ConfigSelectOption {
    value: string
    label: ReactNode
    description?: string
}

export interface ConfigSelectProps {
    value?: string | null
    onChange: (next: string | null) => void
    options: ConfigSelectOption[]
    placeholder?: string
    allowClear?: boolean
    disabled?: boolean
    size?: SelectTriggerProps["size"]
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

export function ConfigSelect({
    value,
    onChange,
    options,
    placeholder,
    allowClear,
    disabled,
    size,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: ConfigSelectProps) {
    const showClear = !!allowClear && value != null && value !== "" && !disabled
    return (
        <span className="group/select relative block w-full">
            <Select
                value={value ?? ""}
                onValueChange={(next) => onChange(next === "" ? null : next)}
                disabled={disabled}
            >
                {/* role=combobox takes no name from its contents; fall back to the placeholder. */}
                <SelectTrigger
                    id={id}
                    size={size}
                    aria-label={ariaLabelledby ? undefined : (ariaLabel ?? placeholder)}
                    aria-labelledby={ariaLabelledby}
                >
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem
                            key={option.value}
                            value={option.value}
                            // The item text has to grow for the description to sit at the row's edge.
                            className="[&>span]:min-w-0 [&>span]:flex-1"
                        >
                            <span className="flex items-center justify-between gap-3">
                                <span className="truncate">{option.label}</span>
                                {option.description ? (
                                    <span className="text-colorTextDescription [[data-slot=select-value]_&]:hidden">
                                        {option.description}
                                    </span>
                                ) : null}
                            </span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {showClear ? (
                <button
                    type="button"
                    aria-label="Clear selection"
                    onClick={(e) => {
                        e.stopPropagation()
                        onChange(null)
                    }}
                    className="absolute right-2 top-1/2 hidden -translate-y-1/2 cursor-pointer border-0 bg-colorBgContainer p-0 text-colorTextTertiary hover:text-colorTextSecondary group-hover/select:block"
                >
                    <XCircle size={12} weight="fill" />
                </button>
            ) : null}
        </span>
    )
}

/** antd `<Tooltip title={hint}>`: no hint, no tooltip — the child renders bare. */
export function HintTooltip({hint, children}: {hint?: string; children: ReactElement}) {
    if (!hint) return children
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
