/**
 * LevelSelect Component
 *
 * Adapter that maps CascadingLevelState to HierarchyLevelSelect.
 * Used by CascadingVariant to render each level as a dropdown.
 *
 * Architecture:
 * - Thin wrapper that adapts entity-specific state to the generic HierarchyLevelSelect
 * - Delegates all rendering to HierarchyLevelSelect from @agenta/ui
 */

import React, {useCallback, useMemo} from "react"

import {HierarchyLevelSelect} from "@agenta/ui/components/selection"

import type {CascadingLevelState} from "../../../hooks"

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

    // Create getter functions that use the config
    const getItemId = useCallback((item: unknown) => config.getId(item), [config])
    const getItemLabel = useCallback((item: unknown) => config.getLabel(item), [config])
    const getItemLabelNode = useMemo(
        () => (config.getLabelNode ? (item: unknown) => config.getLabelNode!(item) : undefined),
        [config],
    )
    const getPlaceholderNode = useMemo(
        () =>
            config.getPlaceholderNode
                ? (text: string) => config.getPlaceholderNode!(text)
                : undefined,
        [config],
    )

    // Handle selection change
    const handleSelect = useCallback(
        (id: string | null) => {
            setSelectedId(id)
        },
        [setSelectedId],
    )

    // Get not found content based on state
    const notFoundContent = useMemo(() => {
        if (query.isPending) return "Loading..."
        if (query.isError) return "Error loading items"
        if (!isEnabled) return `Select ${prevLevelLabel?.toLowerCase() ?? "previous level"} first`
        return "No items found"
    }, [query.isPending, query.isError, isEnabled, prevLevelLabel])

    return (
        <HierarchyLevelSelect
            items={items}
            selectedId={effectiveId}
            onSelect={handleSelect}
            getItemId={getItemId}
            getItemLabel={getItemLabel}
            getItemLabelNode={getItemLabelNode}
            getPlaceholderNode={getPlaceholderNode}
            label={label}
            showLabel={showLabel}
            placeholder={placeholder}
            size={size}
            disabled={disabled}
            isLoading={query.isPending}
            isError={query.isError}
            isEnabled={isEnabled}
            showAutoIndicator={showAutoIndicator}
            isAutoSelected={isAutoSelected}
            prevLevelLabel={prevLevelLabel}
            notFoundContent={notFoundContent}
        />
    )
}
