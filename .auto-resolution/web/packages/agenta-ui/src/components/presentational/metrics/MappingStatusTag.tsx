/**
 * MappingStatusTag - Display mapping status indicator
 *
 * Shows the status of a mapping (auto, manual, missing, etc.) as a tag
 * with appropriate color and icon.
 *
 * @example
 * ```tsx
 * import { MappingStatusTag } from '@agenta/ui'
 *
 * <MappingStatusTag status="auto" />
 * <MappingStatusTag status="missing" showIcon />
 * ```
 */

import {memo} from "react"

import {type MappingStatus, getMappingStatusConfig} from "@agenta/shared/utils"
import {MagicWand, Warning} from "@phosphor-icons/react"
import {Tag} from "antd"

import {cn} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface MappingStatusTagProps {
    /** The mapping status */
    status: MappingStatus
    /** Whether to show icon */
    showIcon?: boolean
    /** Size variant */
    size?: "small" | "default"
    /** Additional CSS class */
    className?: string
    /** Custom label override */
    label?: string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the Ant Design tag color for a mapping status
 */
function getTagColor(status: MappingStatus): string {
    switch (status) {
        case "auto":
            return "blue"
        case "manual":
            return "green"
        case "missing":
        case "invalid_path":
            return "red"
        case "type_mismatch":
            return "orange"
        case "optional":
        default:
            return "default"
    }
}

/**
 * Get the icon component for a mapping status
 */
function getStatusIcon(status: MappingStatus, size: number): React.ReactNode {
    switch (status) {
        case "auto":
            return <MagicWand size={size} />
        case "missing":
        case "invalid_path":
        case "type_mismatch":
            return <Warning size={size} />
        default:
            return null
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

export const MappingStatusTag = memo(function MappingStatusTag({
    status,
    showIcon = false,
    size = "default",
    className,
    label,
}: MappingStatusTagProps) {
    const config = getMappingStatusConfig(status)
    const displayLabel = label ?? config.label
    const tagColor = getTagColor(status)
    const iconSize = size === "small" ? 10 : 12

    const icon = showIcon ? getStatusIcon(status, iconSize) : null

    return (
        <Tag
            color={tagColor}
            className={cn(
                "m-0",
                showIcon && "flex items-center gap-1",
                size === "small" && "text-xs py-0",
                className,
            )}
        >
            {icon}
            {displayLabel}
        </Tag>
    )
})

export default MappingStatusTag
