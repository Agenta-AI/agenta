/**
 * Breadcrumb Component
 *
 * Displays the current navigation path in a hierarchical selection.
 *
 * @example
 * ```tsx
 * import {Breadcrumb} from '@agenta/ui'
 *
 * <Breadcrumb
 *   path={breadcrumb}
 *   onNavigate={navigateToLevel}
 *   rootLabel="All Apps"
 * />
 * ```
 */

import React from "react"

import {Breadcrumb as AntBreadcrumb} from "antd"
import {Home} from "lucide-react"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Generic breadcrumb path item
 */
export interface BreadcrumbPathItem {
    /** Unique identifier for this level */
    id: string
    /** Display label */
    label: string
}

export interface BreadcrumbProps {
    /**
     * Current path items
     */
    path: BreadcrumbPathItem[]

    /**
     * Callback when a breadcrumb item is clicked
     */
    onNavigate: (level: number) => void

    /**
     * Root label (shown when at root level)
     * @default "Home"
     */
    rootLabel?: string

    /**
     * Show home icon at root
     * @default true
     */
    showHomeIcon?: boolean

    /**
     * Additional CSS class
     */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Breadcrumb navigation for hierarchical selection
 */
export function Breadcrumb({
    path,
    onNavigate,
    rootLabel = "Home",
    showHomeIcon = true,
    className,
}: BreadcrumbProps) {
    const items = [
        {
            key: "root",
            title: (
                <span
                    className="cursor-pointer hover:text-primary"
                    onClick={() => onNavigate(0)}
                    role="button"
                    tabIndex={0}
                    onKeyPress={(e) => e.key === "Enter" && onNavigate(0)}
                >
                    {showHomeIcon && <Home className="w-3 h-3 mr-1 inline" />}
                    {rootLabel}
                </span>
            ),
        },
        ...path.map((item, index) => ({
            key: item.id,
            title: (
                <span
                    className="cursor-pointer hover:text-primary"
                    onClick={() => onNavigate(index + 1)}
                    role="button"
                    tabIndex={0}
                    onKeyPress={(e) => e.key === "Enter" && onNavigate(index + 1)}
                >
                    {item.label}
                </span>
            ),
        })),
    ]

    return <AntBreadcrumb items={items} className={className} />
}

// Also export with "Entity" prefix for backward compatibility
export {Breadcrumb as EntityBreadcrumb}
export type {BreadcrumbProps as EntityBreadcrumbProps}
export type {BreadcrumbPathItem as SelectionPathItem}
