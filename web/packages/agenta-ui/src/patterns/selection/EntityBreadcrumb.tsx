/**
 * EntityBreadcrumb Component
 *
 * Displays the current navigation path in a hierarchical selection.
 *
 * @example
 * ```tsx
 * import {EntityBreadcrumb} from '@agenta/ui/components/selection'
 *
 * <EntityBreadcrumb
 *   path={breadcrumb}
 *   onNavigate={navigateToLevel}
 *   rootLabel="All Apps"
 * />
 * ```
 */

import React from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {HouseIcon} from "@phosphor-icons/react"

import {
    Breadcrumb as BreadcrumbRoot,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbSeparator,
} from "../../primitives/breadcrumb"

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

export interface EntityBreadcrumbProps {
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
export function EntityBreadcrumb({
    path,
    onNavigate,
    rootLabel: rootLabelProp,
    showHomeIcon = true,
    className,
}: EntityBreadcrumbProps) {
    const t = useT(navigationCatalog)
    const rootLabel = rootLabelProp ?? t("navigation.items.home")
    const items = [
        {
            key: "root",
            title: (
                <span
                    className="cursor-pointer hover:text-primary flex items-center"
                    onClick={() => onNavigate(0)}
                    role="button"
                    tabIndex={0}
                    onKeyPress={(e) => e.key === "Enter" && onNavigate(0)}
                >
                    {showHomeIcon && <HouseIcon className="w-3 h-3 mr-1 inline" />}
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

    // Every crumb here is clickable (there is no non-interactive "current page" crumb), so each
    // title node is rendered as-is inside its item — exactly what antd did with `items[].title`.
    return (
        <BreadcrumbRoot className={className}>
            <BreadcrumbList>
                {items.map((item, index) => (
                    <React.Fragment key={item.key}>
                        {index > 0 && <BreadcrumbSeparator />}
                        <BreadcrumbItem>{item.title}</BreadcrumbItem>
                    </React.Fragment>
                ))}
            </BreadcrumbList>
        </BreadcrumbRoot>
    )
}
