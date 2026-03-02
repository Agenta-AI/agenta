/**
 * CopyButtonDropdown Component
 *
 * A specialized dropdown button for copy actions.
 * Remembers the last selected action via localStorage using DropdownButton's storageKey feature.
 */

import React, {useMemo} from "react"

import {Link} from "@phosphor-icons/react"

import {DropdownButton, type DropdownButtonOption} from "./DropdownButton"

// ============================================================================
// TYPES
// ============================================================================

export interface CopyOption {
    /** Unique key for this option */
    key: string
    /** Label to display on the main button when this option is selected */
    label: string
    /** Label to display in the dropdown menu (defaults to label if not provided) */
    menuLabel?: string
    /** Whether this option is disabled */
    disabled?: boolean
    /** Icon to show in the dropdown (optional) */
    icon?: React.ReactNode
}

export interface CopyButtonDropdownProps {
    /** Array of options */
    options: CopyOption[]
    /** Storage key for persisting last selected action */
    storageKey?: string
    /** Button size */
    size?: "small" | "middle" | "large"
    /** Additional class name for the container */
    className?: string
    /** Callback when an option is selected (main button click or dropdown item click) */
    onSelect: (key: string) => void
    /** Icon to show on the main button */
    icon?: React.ReactNode
    /** Whether to show the icon on the main button */
    showIcon?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CopyButtonDropdown({
    options,
    storageKey = "copy-button-last-action",
    size = "small",
    className = "",
    onSelect,
    icon = <Link size={14} weight="bold" />,
    showIcon = true,
}: CopyButtonDropdownProps) {
    // Convert CopyOptions to DropdownButtonOptions
    const dropdownOptions: DropdownButtonOption[] = useMemo(
        () =>
            options.map((option) => ({
                key: option.key,
                label: option.menuLabel ?? option.label,
                icon: option.icon,
                disabled: option.disabled,
            })),
        [options],
    )

    return (
        <DropdownButton
            icon={showIcon ? icon : undefined}
            options={dropdownOptions}
            onOptionSelect={onSelect}
            size={size}
            className={className}
            storageKey={storageKey}
        />
    )
}

export default CopyButtonDropdown
