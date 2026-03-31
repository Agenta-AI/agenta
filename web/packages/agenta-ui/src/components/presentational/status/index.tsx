/**
 * Status Components
 *
 * Reusable components for displaying status indicators.
 *
 * @example
 * ```tsx
 * import { StatusTag } from '@agenta/ui'
 *
 * <StatusTag status="loading" />
 * <StatusTag status="ready" />
 * <StatusTag status="error" />
 * ```
 */

import {Tag} from "antd"

// ============================================================================
// TYPES
// ============================================================================

export type QueryStatus = "loading" | "error" | "ready"
export type ExecutionStatus = "idle" | "pending" | "running" | "success" | "error"

export interface StatusTagProps {
    /**
     * The status to display
     */
    status: QueryStatus | ExecutionStatus
    /**
     * Custom label (defaults to capitalized status)
     */
    label?: string
    /**
     * Size variant
     * @default "default"
     */
    size?: "small" | "default"
    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the Ant Design color for a status
 */
export function getStatusColor(status: QueryStatus | ExecutionStatus): string {
    switch (status) {
        case "loading":
        case "pending":
            return "warning"
        case "running":
            return "processing"
        case "error":
            return "error"
        case "success":
        case "ready":
            return "success"
        case "idle":
        default:
            return "default"
    }
}

/**
 * Get the default label for a status
 */
export function getStatusLabel(status: QueryStatus | ExecutionStatus): string {
    switch (status) {
        case "loading":
            return "Loading..."
        case "pending":
            return "Pending"
        case "running":
            return "Running..."
        case "error":
            return "Error"
        case "success":
            return "Success"
        case "ready":
            return "Ready"
        case "idle":
            return "Idle"
        default:
            return status
    }
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * A status indicator tag with consistent styling
 */
export function StatusTag({status, label, size = "default", className}: StatusTagProps) {
    const color = getStatusColor(status)
    const displayLabel = label ?? getStatusLabel(status)

    return (
        <Tag
            color={color}
            className={`m-0 ${size === "small" ? "text-[10px] leading-tight py-0" : ""} ${className ?? ""}`}
        >
            {displayLabel}
        </Tag>
    )
}
