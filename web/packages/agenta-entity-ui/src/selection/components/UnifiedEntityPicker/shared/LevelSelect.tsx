/**
 * LevelSelect Component
 *
 * Reusable select component for a single hierarchy level.
 * Used by CascadingVariant to render each level as a dropdown.
 */

import React, {useMemo} from "react"

import {cn, textColors} from "@agenta/ui"
import {Select, Typography} from "antd"

import type {CascadingLevelState} from "../../../hooks"

const {Text} = Typography

// ============================================================================
// TYPES
// ============================================================================

export interface LevelSelectProps {
    /**
     * Level state from useCascadingMode
     */
    level: CascadingLevelState

    /**
     * Show label above the select
     */
    showLabel: boolean

    /**
     * Custom placeholder (overrides level default)
     */
    placeholder?: string

    /**
     * Select size
     */
    size: "small" | "middle" | "large"

    /**
     * Disabled state
     */
    disabled: boolean

    /**
     * Show "(auto)" indicator when auto-selected
     */
    showAutoIndicator: boolean

    /**
     * Previous level's label (for "Select X first" placeholder)
     */
    prevLevelLabel?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Renders a single hierarchy level as an Ant Design Select.
 *
 * Features:
 * - Rich label rendering via getLabelNode
 * - Placeholder from getPlaceholderNode for consistent height
 * - Search filtering
 * - Loading state
 * - Auto-select indicator
 */
export function LevelSelect({
    level,
    showLabel,
    placeholder,
    size,
    disabled,
    showAutoIndicator,
    prevLevelLabel,
}: LevelSelectProps) {
    const {config, items, query, effectiveId, isEnabled, setSelectedId, isAutoSelected} = level

    // Get label from config or capitalize type
    const label = config.label ?? config.type.charAt(0).toUpperCase() + config.type.slice(1)

    // Build placeholder text
    const defaultPlaceholder = query.isPending
        ? "Loading..."
        : isEnabled
          ? `Select ${label.toLowerCase()}...`
          : prevLevelLabel
            ? `Select ${prevLevelLabel.toLowerCase()} first`
            : "Select previous level first"

    const effectivePlaceholderText = placeholder ?? defaultPlaceholder

    // Build placeholder - use getPlaceholderNode if available for consistent height
    const effectivePlaceholder = useMemo(() => {
        if (config.getPlaceholderNode) {
            return config.getPlaceholderNode(effectivePlaceholderText)
        }
        return effectivePlaceholderText
    }, [config, effectivePlaceholderText])

    // Build options - use getLabelNode for rich rendering, keep string label for search
    const options = useMemo(() => {
        return items.map((item) => {
            const stringLabel = config.getLabel(item)
            const labelNode = config.getLabelNode?.(item)
            return {
                value: config.getId(item),
                // Use labelNode for display if available, otherwise use string
                label: labelNode ?? stringLabel,
                // Store string label for search filtering
                searchLabel: stringLabel,
            }
        })
    }, [items, config])

    // Handle change
    const handleChange = (value: string | null) => {
        setSelectedId(value ?? null)
    }

    // Get not found content based on state
    const getNotFoundContent = () => {
        if (query.isPending) return "Loading..."
        if (query.isError) return "Error loading items"
        if (!isEnabled) return `Select ${prevLevelLabel?.toLowerCase() ?? "previous level"} first`
        return "No items found"
    }

    return (
        <div className="flex flex-col min-w-0">
            {showLabel && (
                <Text className={cn("text-xs mb-1 block", textColors.secondary)}>
                    {label}
                    {showAutoIndicator && isAutoSelected && (
                        <span className="text-zinc-400 ml-1">(auto)</span>
                    )}
                </Text>
            )}
            <Select
                className="w-full"
                placeholder={effectivePlaceholder}
                value={effectiveId}
                onChange={handleChange}
                loading={query.isPending}
                disabled={disabled || !isEnabled || query.isPending}
                status={query.isError ? "error" : undefined}
                options={options}
                size={size}
                showSearch
                filterOption={(input, option) => {
                    // Use searchLabel for filtering if available, otherwise try label
                    const searchText =
                        (option as {searchLabel?: string})?.searchLabel ?? String(option?.label)
                    return searchText.toLowerCase().includes(input.toLowerCase())
                }}
                notFoundContent={getNotFoundContent()}
                allowClear
            />
        </div>
    )
}
