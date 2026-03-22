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

// ============================================================================
// ENVIRONMENT TAG
// ============================================================================

export type EnvironmentName = "production" | "staging" | "development"

export const environmentColors: Record<
    EnvironmentName,
    {bgColor: string; textColor: string; label: string}
> = {
    production: {bgColor: "#D9F7BE", textColor: "#237804", label: "Production"},
    staging: {bgColor: "#FFF2E8", textColor: "#FA541C", label: "Staging"},
    development: {bgColor: "#F9F0FF", textColor: "#722ED1", label: "Development"},
}

export interface EnvironmentTagProps {
    environment: string
    className?: string
}

export function EnvironmentTag({environment, className}: EnvironmentTagProps) {
    const known = environmentColors[environment.toLowerCase() as EnvironmentName]
    const label = known?.label ?? (environment || "Unknown")

    return (
        <Tag
            className={`w-fit ${className ?? ""}`}
            style={
                known
                    ? {
                          backgroundColor: known.bgColor,
                          color: known.textColor,
                          borderColor: known.bgColor,
                      }
                    : undefined
            }
        >
            {label}
        </Tag>
    )
}
