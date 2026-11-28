/**
 * Entity Icon Label Components
 *
 * Reusable components for displaying entity headers with icon, label, and metadata.
 *
 * @example
 * ```tsx
 * import { EntityIconLabel, PanelHeader } from '@agenta/ui'
 *
 * <EntityIconLabel
 *   icon={<Lightning weight="fill" />}
 *   iconBgColor="bg-secondary"
 *   iconColor="text-muted-foreground"
 *   label="My App"
 *   version={3}
 *   subtitle="appRevision"
 *   status="ready"
 * />
 *
 * <PanelHeader
 *   icon={<Lightning weight="fill" />}
 *   label="My App"
 *   version={3}
 *   status="ready"
 *   actions={<Button>Edit</Button>}
 * />
 * ```
 */

import type {ReactNode} from "react"

import {cn} from "../../ui/utils"
import {type QueryStatus, type ExecutionStatus} from "../status"
import {Tag} from "../tag"
import {VersionBadge} from "../version"

// ============================================================================
// TYPES
// ============================================================================

export interface EntityIconLabelProps {
    /**
     * Icon element to display
     */
    icon: ReactNode
    /**
     * Background color class for the icon container
     * @default "bg-secondary"
     */
    iconBgColor?: string
    /**
     * Text color class for the icon
     * @default "text-muted-foreground"
     */
    iconColor?: string
    /**
     * Icon container size
     * @default "md"
     */
    iconSize?: "sm" | "md"
    /**
     * Main label text
     */
    label: string
    /**
     * Optional version number (displays VersionBadge)
     */
    version?: number | string
    /**
     * Optional subtitle text (displayed below label)
     */
    subtitle?: string
    /**
     * Optional status indicator
     */
    status?: QueryStatus | ExecutionStatus
    /**
     * Additional content to render after the label
     */
    extra?: ReactNode
    /**
     * Additional CSS class
     */
    className?: string
}

export interface PanelHeaderProps {
    /**
     * Icon element to display
     */
    icon: ReactNode
    /**
     * Background color class for the icon container
     * @default "bg-secondary"
     */
    iconBgColor?: string
    /**
     * Text color class for the icon
     * @default "text-muted-foreground"
     */
    iconColor?: string
    /**
     * Main label text
     */
    label: string
    /**
     * Optional version number (displays VersionBadge)
     */
    version?: number | string
    /**
     * Optional subtitle text (displayed below label)
     */
    subtitle?: string
    /**
     * Optional status indicator
     */
    status?: QueryStatus | ExecutionStatus
    /**
     * Action buttons or content for the right side
     */
    actions?: ReactNode
    /**
     * Whether the header should be sticky
     * @default true
     */
    sticky?: boolean
    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Entity icon with label, version badge, and optional metadata
 */
export function EntityIconLabel({
    icon,
    iconBgColor = "bg-secondary",
    iconColor = "text-muted-foreground",
    iconSize = "md",
    label,
    version,
    subtitle,
    status,
    extra,
    className,
}: EntityIconLabelProps) {
    const sizeClasses = iconSize === "sm" ? "w-6 h-6" : "w-8 h-8"

    return (
        <div className={cn("flex items-center gap-3", className)}>
            <div
                className={cn(
                    sizeClasses,
                    "flex items-center justify-center rounded-lg flex-shrink-0",
                    iconBgColor,
                )}
            >
                <span className={iconColor}>{icon}</span>
            </div>
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span
                        className={cn(
                            "font-semibold",
                            iconSize === "sm" ? "text-label" : "text-body",
                        )}
                    >
                        {label}
                    </span>
                    {version !== undefined && <VersionBadge version={version} variant="chip" />}
                    {status && <Tag status={status} />}
                    {extra}
                </div>
                {subtitle && (
                    <span className="text-meta capitalize text-muted-foreground">{subtitle}</span>
                )}
            </div>
        </div>
    )
}

/**
 * Panel header with icon, label, and action buttons
 * Commonly used at the top of configuration panels
 */
export function PanelHeader({
    icon,
    iconBgColor = "bg-secondary",
    iconColor = "text-muted-foreground",
    label,
    version,
    subtitle,
    status,
    actions,
    sticky = true,
    className,
}: PanelHeaderProps) {
    return (
        <div
            className={cn(
                "px-4 py-3 border-0 border-b border-solid border-border-muted bg-background",
                sticky && "sticky top-0 z-10",
                className,
            )}
        >
            <div className="flex items-center justify-between">
                <EntityIconLabel
                    icon={icon}
                    iconBgColor={iconBgColor}
                    iconColor={iconColor}
                    label={label}
                    version={version}
                    subtitle={subtitle}
                    status={status}
                />
                {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
        </div>
    )
}
