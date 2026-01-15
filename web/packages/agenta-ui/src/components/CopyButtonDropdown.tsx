/**
 * CopyButtonDropdown Component
 *
 * A generic button with a dropdown for selecting and executing actions.
 * Remembers the last selected action via localStorage.
 * Users define their own callbacks for handling the selected action.
 */

import React, {useEffect, useMemo, useState, useCallback} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Link} from "@phosphor-icons/react"
import {Button, Dropdown, Space} from "antd"
import type {MenuProps} from "antd"

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
    /** Currently active/selected key (for showing different label, e.g., "Copied!") */
    activeKey?: string | null
    /** Label to show when activeKey matches an option (defaults to option's label) */
    activeLabel?: string
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
    activeKey = null,
    activeLabel = "Copied!",
}: CopyButtonDropdownProps) {
    // Track which option was last selected
    const [lastSelectedKey, setLastSelectedKey] = useState<string>(options[0]?.key ?? "")

    // Load last selected action from localStorage
    useEffect(() => {
        if (storageKey) {
            const saved = localStorage.getItem(storageKey)
            if (saved && options.some((opt) => opt.key === saved)) {
                setLastSelectedKey(saved)
            }
        }
    }, [storageKey, options])

    // Handle option selection
    const handleSelect = useCallback(
        (key: string) => {
            // Update last selected
            setLastSelectedKey(key)
            if (storageKey) {
                localStorage.setItem(storageKey, key)
            }
            // Call user's callback
            onSelect(key)
        },
        [storageKey, onSelect],
    )

    // Main button click - execute last selected action
    const handleMainButtonClick = useCallback(() => {
        // If last selected option is disabled, find first available
        const lastOption = options.find((opt) => opt.key === lastSelectedKey)
        if (lastOption && !lastOption.disabled) {
            handleSelect(lastSelectedKey)
        } else {
            // Find first available option
            const firstAvailable = options.find((opt) => !opt.disabled)
            if (firstAvailable) {
                handleSelect(firstAvailable.key)
            }
        }
    }, [options, lastSelectedKey, handleSelect])

    // Dropdown menu items
    const menuItems: MenuProps["items"] = useMemo(
        () =>
            options.map((option) => ({
                key: option.key,
                label: activeKey === option.key ? activeLabel : (option.menuLabel ?? option.label),
                icon: option.icon,
                disabled: option.disabled,
                onClick: () => handleSelect(option.key),
            })),
        [options, activeKey, activeLabel, handleSelect],
    )

    // Get label for main button
    const mainButtonLabel = useMemo(() => {
        const lastOption = options.find((opt) => opt.key === lastSelectedKey)
        // If last option is disabled, show first available
        if (!lastOption || lastOption.disabled) {
            const firstAvailable = options.find((opt) => !opt.disabled)
            if (firstAvailable) {
                return activeKey === firstAvailable.key ? activeLabel : firstAvailable.label
            }
        }
        return activeKey === lastSelectedKey
            ? activeLabel
            : (lastOption?.label ?? options[0]?.label ?? "Copy")
    }, [options, lastSelectedKey, activeKey, activeLabel])

    return (
        <Space.Compact size={size} className={className}>
            <Button className="flex items-center gap-1" onClick={handleMainButtonClick}>
                {showIcon && icon}
                <span>{mainButtonLabel}</span>
            </Button>
            <Dropdown menu={{items: menuItems}} trigger={["hover"]} placement="bottomRight">
                <Button icon={<DownOutlined style={{fontSize: 10}} />} />
            </Dropdown>
        </Space.Compact>
    )
}

export default CopyButtonDropdown
