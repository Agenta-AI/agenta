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
 *   iconBgColor="bg-blue-100"
 *   iconColor="text-blue-600"
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

import {Typography} from "antd"

import {
    bgColors,
    borderColors,
    cn,
    entityIconColors,
    flexLayouts,
    gapClasses,
    justifyClasses,
    spacingClasses,
    textSizes,
} from "../../../utils/styles"
import {StatusTag, type QueryStatus, type ExecutionStatus} from "../status"
import {VersionBadge} from "../version"

const {Text} = Typography

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
     * @default entityIconColors.primaryBg
     */
    iconBgColor?: string
    /**
     * Text color class for the icon
     * @default entityIconColors.primary
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
    version?: number
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
     * @default entityIconColors.primaryBg
     */
    iconBgColor?: string
    /**
     * Text color class for the icon
     * @default entityIconColors.primary
     */
    iconColor?: string
    /**
     * Main label text
     */
    label: string
    /**
     * Optional version number (displays VersionBadge)
     */
    version?: number
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
    iconBgColor = entityIconColors.primaryBg,
    iconColor = entityIconColors.primary,
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
        <div className={cn(flexLayouts.rowCenter, gapClasses.md, className)}>
            <div
                className={cn(
                    sizeClasses,
                    flexLayouts.rowCenter,
                    justifyClasses.center,
                    "rounded-lg flex-shrink-0",
                    iconBgColor,
                )}
            >
                <span className={iconColor}>{icon}</span>
            </div>
            <div className="min-w-0">
                <div className={cn(flexLayouts.rowCenter, gapClasses.sm, "flex-wrap")}>
                    <Text strong className={iconSize === "sm" ? textSizes.sm : textSizes.base}>
                        {label}
                    </Text>
                    {version !== undefined && <VersionBadge version={version} variant="chip" />}
                    {status && <StatusTag status={status} />}
                    {extra}
                </div>
                {subtitle && (
                    <Text type="secondary" className={cn(textSizes.xs, "capitalize")}>
                        {subtitle}
                    </Text>
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
    iconBgColor = entityIconColors.primaryBg,
    iconColor = entityIconColors.primary,
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
                spacingClasses.card,
                "border-b",
                borderColors.secondary,
                bgColors.container,
                sticky && "sticky top-0 z-10",
                className,
            )}
        >
            <div className={cn(flexLayouts.rowCenter, justifyClasses.between)}>
                <EntityIconLabel
                    icon={icon}
                    iconBgColor={iconBgColor}
                    iconColor={iconColor}
                    label={label}
                    version={version}
                    subtitle={subtitle}
                    status={status}
                />
                {actions && (
                    <div className={cn(flexLayouts.rowCenter, gapClasses.sm)}>{actions}</div>
                )}
            </div>
        </div>
    )
}
