/**
 * DropdownButton Component
 *
 * A generic split button with a main action and a dropdown for additional options.
 * Uses Ant Design's Space.Compact for the split button pattern.
 *
 * Supports optional localStorage persistence for remembering the last selected option
 * using Jotai's atomWithStorage.
 */

import React, {useCallback, useMemo} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Dropdown, Space} from "antd"
import type {ButtonProps, MenuProps} from "antd"
import {useAtom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

// ============================================================================
// ATOMS
// ============================================================================

/**
 * Atom family for persisting dropdown button selections to localStorage.
 * Each storageKey gets its own atom with localStorage persistence.
 */
export const dropdownSelectionAtomFamily = atomFamily((storageKey: string) =>
    atomWithStorage<string | null>(`agenta:dropdown:${storageKey}`, null),
)

/**
 * Hook to use dropdown selection state with localStorage persistence.
 * Returns [selectedKey, setSelectedKey] tuple.
 */
function useDropdownSelection(storageKey: string | undefined, defaultKey: string) {
    const atom = storageKey ? dropdownSelectionAtomFamily(storageKey) : null
    const [storedKey, setStoredKey] = useAtom(atom ?? dropdownSelectionAtomFamily("__noop__"))

    // If no storageKey, we don't use the atom at all
    if (!storageKey) {
        return [defaultKey, () => {}] as const
    }

    // Use stored value or fall back to default
    const effectiveKey = storedKey ?? defaultKey
    return [effectiveKey, setStoredKey] as const
}

// ============================================================================
// TYPES
// ============================================================================

export interface DropdownButtonOption {
    /** Unique key for this option */
    key: string
    /** Label to display in the dropdown menu */
    label: React.ReactNode
    /** Whether this option is disabled */
    disabled?: boolean
    /** Icon to show in the dropdown (optional) */
    icon?: React.ReactNode
}

export interface DropdownButtonProps {
    /** Label for the main button (used when not using storageKey) */
    label?: React.ReactNode
    /** Icon for the main button (optional) */
    icon?: React.ReactNode
    /** Array of dropdown options */
    options: DropdownButtonOption[]
    /** Callback when main button is clicked (used when not using storageKey) */
    onClick?: () => void
    /** Callback when a dropdown option is selected */
    onOptionSelect?: (key: string) => void
    /** Button size */
    size?: "small" | "middle" | "large"
    /** Button type for main button */
    type?: ButtonProps["type"]
    /** Additional class name for the container */
    className?: string
    /** Whether the main button is disabled */
    disabled?: boolean
    /** Whether the dropdown button is disabled */
    dropdownDisabled?: boolean
    /** Dropdown trigger */
    trigger?: ("click" | "hover" | "contextMenu")[]
    /** Dropdown placement */
    placement?: "bottom" | "bottomLeft" | "bottomRight" | "top" | "topLeft" | "topRight"
    /** Custom dropdown icon (defaults to DownOutlined) */
    dropdownIcon?: React.ReactNode
    /**
     * Optional localStorage key for persisting the last selected option.
     * When provided, the main button will show the last selected option's label
     * and clicking it will execute that option's action.
     */
    storageKey?: string
    /** Default selected key when using storageKey (defaults to first option) */
    defaultSelectedKey?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function DropdownButton({
    label,
    icon,
    options,
    onClick,
    onOptionSelect,
    size = "middle",
    type = "default",
    className = "",
    disabled = false,
    dropdownDisabled = false,
    trigger = ["hover"],
    placement = "bottomRight",
    dropdownIcon,
    storageKey,
    defaultSelectedKey,
}: DropdownButtonProps) {
    // Use atomWithStorage for persistence when storageKey is provided
    const defaultKey = defaultSelectedKey ?? options[0]?.key ?? ""
    const [selectedKey, setSelectedKey] = useDropdownSelection(storageKey, defaultKey)

    // Handle option selection with storage persistence
    const handleOptionSelect = useCallback(
        (key: string) => {
            if (storageKey) {
                setSelectedKey(key)
            }
            onOptionSelect?.(key)
        },
        [storageKey, setSelectedKey, onOptionSelect],
    )

    // Handle main button click
    const handleMainClick = useCallback(() => {
        if (storageKey) {
            // When using storage, execute the selected option
            const selectedOption = options.find((opt) => opt.key === selectedKey)
            if (selectedOption && !selectedOption.disabled) {
                handleOptionSelect(selectedKey)
            } else {
                // Fallback to first available option
                const firstAvailable = options.find((opt) => !opt.disabled)
                if (firstAvailable) {
                    handleOptionSelect(firstAvailable.key)
                }
            }
        } else {
            // When not using storage, use the provided onClick
            onClick?.()
        }
    }, [storageKey, options, selectedKey, handleOptionSelect, onClick])

    // Get the effective label for the main button
    const effectiveLabel = useMemo(() => {
        if (storageKey) {
            const selectedOption = options.find((opt) => opt.key === selectedKey)
            if (selectedOption && !selectedOption.disabled) {
                return selectedOption.label
            }
            // Fallback to first available
            const firstAvailable = options.find((opt) => !opt.disabled)
            return firstAvailable?.label ?? label
        }
        return label
    }, [storageKey, options, selectedKey, label])

    // Dropdown menu items
    const menuItems: MenuProps["items"] = useMemo(
        () =>
            options.map((option) => ({
                key: option.key,
                label: option.label,
                icon: option.icon,
                disabled: option.disabled,
                onClick: () => handleOptionSelect(option.key),
            })),
        [options, handleOptionSelect],
    )

    const chevronIcon = dropdownIcon ?? <DownOutlined style={{fontSize: 10}} />

    return (
        <Space.Compact size={size} className={className}>
            <Button
                type={type}
                className="flex items-center gap-1"
                onClick={handleMainClick}
                disabled={disabled}
                icon={icon}
            >
                {effectiveLabel}
            </Button>
            <Dropdown
                menu={{items: menuItems}}
                trigger={trigger}
                placement={placement}
                disabled={dropdownDisabled || disabled}
            >
                <Button type={type} icon={chevronIcon} disabled={dropdownDisabled || disabled} />
            </Dropdown>
        </Space.Compact>
    )
}

export default DropdownButton
