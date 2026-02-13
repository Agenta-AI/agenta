/**
 * PathSelector Component
 *
 * Reusable dropdown for selecting source paths (output or testcase).
 * Uses PathSelectorDropdown from @agenta/ui for the underlying implementation.
 */

import type {PathInfo} from "@agenta/entities/runnable"
import {PathSelectorDropdown} from "@agenta/ui/components/presentational"

export interface PathSelectorProps {
    value: string | undefined
    onChange: (value: string) => void
    availablePaths: PathInfo[]
    placeholder?: string
    allowClear?: boolean
    size?: "small" | "middle" | "large"
    className?: string
}

/**
 * Dropdown selector for source paths with type indicators
 *
 * This is a thin wrapper around PathSelectorDropdown from @agenta/ui
 * to maintain backward compatibility with existing code.
 */
export function PathSelector({
    value,
    onChange,
    availablePaths,
    placeholder = "Select source...",
    allowClear = false,
    size = "small",
    className = "w-full",
}: PathSelectorProps) {
    return (
        <PathSelectorDropdown
            value={value}
            onChange={onChange}
            paths={availablePaths}
            placeholder={placeholder}
            allowClear={allowClear}
            size={size}
            className={className}
        />
    )
}
