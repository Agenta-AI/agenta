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

import {Input} from "antd"
import {Search, XCircle} from "lucide-react"

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
     * @default "middle"
     */
    size?: "small" | "middle" | "large"
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
    size = "middle",
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
        <Input
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className={className}
            size={size}
            prefix={<Search className="w-4 h-4 text-zinc-400" />}
            suffix={
                value ? (
                    <XCircle
                        className="w-4 h-4 text-zinc-400 hover:text-zinc-600 cursor-pointer"
                        onClick={handleClear}
                    />
                ) : null
            }
            allowClear={false}
        />
    )
}
