/**
 * DrillInBreadcrumb Component
 *
 * Reusable breadcrumb navigation for drill-in views.
 * Supports smart truncation for long paths.
 */

import {memo, type ReactNode, useMemo} from "react"

import {ArrowLeft, CaretRight, DotsThree} from "@phosphor-icons/react"

import {Button} from "../../../primitives/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../../primitives/dropdown-menu"

export interface DrillInBreadcrumbProps {
    /** Current navigation path */
    currentPath: string[]
    /** Title for the root level */
    rootTitle: string
    /** Callback when back button is clicked */
    onNavigateBack: () => void
    /** Callback when a path segment is clicked */
    onNavigateToIndex: (index: number) => void
    /** Optional custom root element to render instead of the default root title button */
    renderRoot?: () => ReactNode
    /** Optional prefix element to render before the breadcrumb (e.g., span navigation) */
    prefix?: ReactNode
    /** Whether to show the back arrow button (default: true) */
    showBackArrow?: boolean
    /** Maximum visible segments before truncation (default: 3) */
    maxVisibleSegments?: number
}

/**
 * Format a path segment for display
 * Converts numeric indices to human-friendly names based on parent key
 * e.g., "0" after "messages" becomes "Message 1"
 */
function formatSegment(segment: string, parentSegment?: string): string {
    // Check if this is a numeric index
    const numericIndex = parseInt(segment, 10)
    if (!isNaN(numericIndex) && String(numericIndex) === segment) {
        // Get singular name from parent key
        const parentKey = parentSegment || ""
        const singularName = parentKey.endsWith("s") ? parentKey.slice(0, -1) : parentKey || "Item"
        // Capitalize first letter
        const displayName = singularName.charAt(0).toUpperCase() + singularName.slice(1)
        return `${displayName} ${numericIndex + 1}`
    }
    return segment
}

/**
 * Reusable breadcrumb navigation component for drill-in views
 * Supports smart truncation for long paths: root > ... > prevKey > currentKey
 */
export const DrillInBreadcrumb = memo(
    ({
        currentPath,
        rootTitle,
        onNavigateBack,
        onNavigateToIndex,
        renderRoot,
        prefix,
        showBackArrow = true,
        maxVisibleSegments = 3,
    }: DrillInBreadcrumbProps) => {
        // Calculate which segments to show and which to hide
        const {visibleSegments, hiddenSegments, showEllipsis} = useMemo(() => {
            if (currentPath.length <= maxVisibleSegments) {
                return {
                    visibleSegments: currentPath.map((seg, i) => ({
                        segment: seg,
                        originalIndex: i,
                    })),
                    hiddenSegments: [],
                    showEllipsis: false,
                }
            }

            // Show only the last (maxVisibleSegments) segments, hide the rest
            const lastSegments = currentPath.slice(-maxVisibleSegments).map((seg, i) => ({
                segment: seg,
                originalIndex: currentPath.length - maxVisibleSegments + i,
            }))
            const hidden = currentPath.slice(0, -maxVisibleSegments).map((seg, i) => ({
                segment: seg,
                originalIndex: i,
            }))

            return {
                visibleSegments: lastSegments,
                hiddenSegments: hidden,
                showEllipsis: true,
            }
        }, [currentPath, maxVisibleSegments])

        // Build dropdown menu items for hidden segments
        const dropdownItems = useMemo(
            () =>
                hiddenSegments.map(({segment, originalIndex}) => {
                    const parentSegment =
                        originalIndex > 0 ? currentPath[originalIndex - 1] : undefined
                    const displaySegment = formatSegment(segment, parentSegment)
                    return {
                        key: String(originalIndex),
                        label: displaySegment,
                        onClick: () => onNavigateToIndex(originalIndex + 1),
                    }
                }),
            [hiddenSegments, currentPath, onNavigateToIndex],
        )

        return (
            <div className="drill-in-breadcrumb flex items-center gap-1 min-h-8 sticky top-0 bg-background z-10 py-2">
                {/* Fixed prefix (span navigation) - doesn't scroll */}
                {prefix && <div className="flex-shrink-0 flex items-center">{prefix}</div>}

                {/* Breadcrumb path */}
                <div className="flex items-center gap-1 flex-nowrap min-w-0">
                    {showBackArrow && currentPath.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onNavigateBack}
                            className="!px-2 flex-shrink-0"
                        >
                            {<ArrowLeft size={14} />}
                        </Button>
                    )}
                    {renderRoot ? (
                        renderRoot()
                    ) : (
                        <button
                            type="button"
                            onClick={() => onNavigateToIndex(0)}
                            className={`px-2 py-1 rounded hover:bg-accent transition-colors bg-transparent border-none cursor-pointer whitespace-nowrap flex-shrink-0 ${currentPath.length === 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                        >
                            {rootTitle}
                        </button>
                    )}

                    {/* Ellipsis dropdown for hidden segments - shown right after root */}
                    {showEllipsis && hiddenSegments.length > 0 && (
                        <div className="flex items-center flex-shrink-0">
                            <CaretRight size={12} className="text-muted-foreground" />
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="box-border px-2 py-1 rounded hover:bg-accent transition-colors bg-transparent border-none cursor-pointer text-muted-foreground"
                                    >
                                        <DotsThree size={16} />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    {dropdownItems.map((item) => (
                                        <DropdownMenuItem key={item.key} onClick={item.onClick}>
                                            {item.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )}

                    {/* Visible segments (last N segments) */}
                    {visibleSegments.map(({segment, originalIndex}) => {
                        const parentSegment =
                            originalIndex > 0 ? currentPath[originalIndex - 1] : undefined
                        const displaySegment = formatSegment(segment, parentSegment)
                        return (
                            <div key={originalIndex} className="flex items-center flex-shrink-0">
                                <CaretRight size={12} className="text-muted-foreground" />
                                <button
                                    type="button"
                                    onClick={() => onNavigateToIndex(originalIndex + 1)}
                                    className={`px-2 py-1 rounded hover:bg-accent transition-colors bg-transparent border-none cursor-pointer whitespace-nowrap ${originalIndex === currentPath.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                                >
                                    {displaySegment}
                                </button>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    },
)

DrillInBreadcrumb.displayName = "DrillInBreadcrumb"
