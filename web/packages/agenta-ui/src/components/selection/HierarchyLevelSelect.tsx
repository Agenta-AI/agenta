/**
 * HierarchyLevelSelect Component
 *
 * A generic select component for hierarchy level selection with support for:
 * - Rich label rendering
 * - Search filtering
 * - Loading states
 * - Custom placeholders
 *
 * This is a generic UI component that can be used by any entity selection system.
 *
 * @example
 * ```tsx
 * import { HierarchyLevelSelect } from '@agenta/ui'
 *
 * <HierarchyLevelSelect
 *   items={apps}
 *   selectedId={selectedAppId}
 *   onSelect={setSelectedAppId}
 *   getItemId={(app) => app.id}
 *   getItemLabel={(app) => app.name}
 *   label="Application"
 *   showLabel
 *   isLoading={isLoading}
 * />
 * ```
 */

import React, {useMemo} from "react"

import {Select, Typography} from "antd"

import {cn, textColors} from "../../utils/styles"

const {Text} = Typography

// ============================================================================
// TYPES
// ============================================================================

export interface HierarchyLevelSelectProps<T> {
    /**
     * Items to display in the select
     */
    items: T[]

    /**
     * Currently selected item ID
     */
    selectedId: string | null

    /**
     * Callback when selection changes
     */
    onSelect: (id: string | null) => void

    /**
     * Get unique ID from item
     */
    getItemId: (item: T) => string

    /**
     * Get string label from item (used for search filtering)
     */
    getItemLabel: (item: T) => string

    /**
     * Get rich label node from item (optional, for display)
     */
    getItemLabelNode?: (item: T) => React.ReactNode

    /**
     * Get placeholder node (optional, for consistent height)
     */
    getPlaceholderNode?: (text: string) => React.ReactNode

    /**
     * Label text for the select
     */
    label?: string

    /**
     * Show label above the select
     * @default false
     */
    showLabel?: boolean

    /**
     * Custom placeholder text
     */
    placeholder?: string

    /**
     * Select size
     * @default "middle"
     */
    size?: "small" | "middle" | "large"

    /**
     * Whether the select is disabled
     * @default false
     */
    disabled?: boolean

    /**
     * Whether the select is loading
     * @default false
     */
    isLoading?: boolean

    /**
     * Whether there is an error
     * @default false
     */
    isError?: boolean

    /**
     * Whether the level is enabled (has required parent selection)
     * @default true
     */
    isEnabled?: boolean

    /**
     * Whether to show auto-select indicator
     * @default false
     */
    showAutoIndicator?: boolean

    /**
     * Whether the current selection was auto-selected
     * @default false
     */
    isAutoSelected?: boolean

    /**
     * Previous level's label (for "Select X first" placeholder)
     */
    prevLevelLabel?: string

    /**
     * Not found content when list is empty
     */
    notFoundContent?: React.ReactNode

    /**
     * Allow clearing the selection
     * @default true
     */
    allowClear?: boolean

    /**
     * Additional class name for the container
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * HierarchyLevelSelect
 *
 * Renders a select dropdown for a single hierarchy level.
 *
 * Features:
 * - Rich label rendering via getItemLabelNode
 * - Placeholder from getPlaceholderNode for consistent height
 * - Search filtering using getItemLabel
 * - Loading state
 * - Error state
 * - Auto-select indicator
 */
export function HierarchyLevelSelect<T>({
    items,
    selectedId,
    onSelect,
    getItemId,
    getItemLabel,
    getItemLabelNode,
    getPlaceholderNode,
    label,
    showLabel = false,
    placeholder,
    size = "middle",
    disabled = false,
    isLoading = false,
    isError = false,
    isEnabled = true,
    showAutoIndicator = false,
    isAutoSelected = false,
    prevLevelLabel,
    notFoundContent,
    allowClear = true,
    className,
}: HierarchyLevelSelectProps<T>) {
    // Build placeholder text
    const defaultPlaceholder = isLoading
        ? "Loading..."
        : isEnabled
          ? `Select ${label?.toLowerCase() ?? "item"}...`
          : prevLevelLabel
            ? `Select ${prevLevelLabel.toLowerCase()} first`
            : "Select previous level first"

    const effectivePlaceholderText = placeholder ?? defaultPlaceholder

    // Build placeholder - use getPlaceholderNode if available for consistent height
    const effectivePlaceholder = useMemo(() => {
        if (getPlaceholderNode) {
            return getPlaceholderNode(effectivePlaceholderText)
        }
        return effectivePlaceholderText
    }, [getPlaceholderNode, effectivePlaceholderText])

    // Build options - use getItemLabelNode for rich rendering, keep string label for search
    const options = useMemo(() => {
        return items.map((item) => {
            const stringLabel = getItemLabel(item)
            const labelNode = getItemLabelNode?.(item)
            return {
                value: getItemId(item),
                // Use labelNode for display if available, otherwise use string
                label: labelNode ?? stringLabel,
                // Store string label for search filtering
                searchLabel: stringLabel,
            }
        })
    }, [items, getItemId, getItemLabel, getItemLabelNode])

    // Handle change
    const handleChange = (value: string | null) => {
        onSelect(value ?? null)
    }

    // Get not found content based on state
    const getNotFoundContentText = () => {
        if (notFoundContent) return notFoundContent
        if (isLoading) return "Loading..."
        if (isError) return "Error loading items"
        if (!isEnabled) return `Select ${prevLevelLabel?.toLowerCase() ?? "previous level"} first`
        return "No items found"
    }

    return (
        <div className={cn("flex flex-col min-w-0", className)}>
            {showLabel && label && (
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
                value={selectedId}
                onChange={handleChange}
                loading={isLoading}
                disabled={disabled || !isEnabled || isLoading}
                status={isError ? "error" : undefined}
                options={options}
                size={size}
                showSearch
                filterOption={(input, option) => {
                    // Use searchLabel for filtering if available, otherwise try label
                    const searchText =
                        (option as {searchLabel?: string})?.searchLabel ?? String(option?.label)
                    return searchText.toLowerCase().includes(input.toLowerCase())
                }}
                notFoundContent={getNotFoundContentText()}
                allowClear={allowClear}
            />
        </div>
    )
}

export default HierarchyLevelSelect
