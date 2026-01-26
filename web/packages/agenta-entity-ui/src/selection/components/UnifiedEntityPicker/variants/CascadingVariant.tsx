/**
 * CascadingVariant Component
 *
 * Cascading select variant for EntityPicker.
 * Renders all hierarchy levels as side-by-side Select dropdowns.
 *
 * Pattern: App Select → Variant Select → Revision Select
 */

import React from "react"

import {cn} from "@agenta/ui/styles"

import {useCascadingMode} from "../../../hooks"
import type {EntitySelectionResult} from "../../../types"
import {LevelSelect} from "../shared"
import type {CascadingVariantProps} from "../types"

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Cascading select variant.
 *
 * Renders N Select components based on the adapter's hierarchy levels.
 * Each level depends on the previous level's selection.
 *
 * @example
 * ```tsx
 * <CascadingVariant
 *     adapter="appRevision"
 *     onSelect={handleSelect}
 *     showLabels
 *     layout="vertical"
 * />
 * ```
 */
export function CascadingVariant<TSelection = EntitySelectionResult>({
    adapter,
    onSelect,
    instanceId,
    autoSelectByLevel,
    showLabels = true,
    layout = "vertical",
    gap = 3,
    size = "middle",
    placeholders,
    className,
    disabled = false,
    showAutoIndicator = true,
}: CascadingVariantProps<TSelection>) {
    // Use the cascading mode hook
    const {levels} = useCascadingMode({
        adapter,
        instanceId,
        onSelect,
        autoSelectByLevel,
    })

    // Layout classes
    const layoutClass = layout === "horizontal" ? "flex-row items-end" : "flex-col"
    const gapClass = `gap-${gap}`

    return (
        <div className={cn("flex", layoutClass, gapClass, className)}>
            {levels.map((level, index) => (
                <LevelSelect
                    key={level.config.type}
                    level={level}
                    showLabel={showLabels}
                    placeholder={placeholders?.[index]}
                    size={size}
                    disabled={disabled}
                    showAutoIndicator={showAutoIndicator}
                    prevLevelLabel={index > 0 ? levels[index - 1].config.label : undefined}
                />
            ))}
        </div>
    )
}
