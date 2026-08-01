/**
 * SearchInput Component
 *
 * Search input for filtering lists with clear button.
 *
 * @example
 * ```tsx
 * import {SearchInput} from '@agenta/ui'
 *
 * <SearchInput
 *   value={searchTerm}
 *   onChange={setSearchTerm}
 *   placeholder="Search apps..."
 *   autoFocus
 * />
 * ```
 */

import React, {useCallback} from "react"

import {Search} from "lucide-react"

import type {InputProps} from "../ui/input"
import {InputAffix} from "../ui/input-composed"

// ============================================================================
// TYPES
// ============================================================================

export interface SearchInputProps {
    /**
     * Current search value
     */
    value: string

    /**
     * Callback when value changes
     */
    onChange: (value: string) => void

    /**
     * Placeholder text
     * @default "Search..."
     */
    placeholder?: string

    /**
     * Whether the input is disabled
     */
    disabled?: boolean

    /**
     * Auto focus on mount
     */
    autoFocus?: boolean

    /**
     * Additional CSS class
     */
    className?: string

    /**
     * Size of the input
     * @default "default"
     */
    size?: InputProps["size"]
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Search input with clear button
 */
export function SearchInput({
    value,
    onChange,
    placeholder = "Search...",
    disabled = false,
    autoFocus = false,
    className = "",
    size = "default",
}: SearchInputProps) {
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            onChange(e.target.value)
        },
        [onChange],
    )

    const handleClear = useCallback(() => {
        onChange("")
    }, [onChange])

    return (
        <InputAffix
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className={className}
            size={size}
            prefix={<Search className="w-4 h-4" />}
            allowClear
            onClear={handleClear}
        />
    )
}
