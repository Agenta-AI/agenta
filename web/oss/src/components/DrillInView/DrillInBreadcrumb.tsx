import {memo, type ReactNode} from "react"

import {ArrowLeft, CaretRight} from "@phosphor-icons/react"
import {Button} from "antd"

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
}

/**
 * Reusable breadcrumb navigation component for drill-in views
 * Used by TestcaseEditDrawer and TraceDataDrillIn
 */
const DrillInBreadcrumb = memo(
    ({
        currentPath,
        rootTitle,
        onNavigateBack,
        onNavigateToIndex,
        renderRoot,
        prefix,
        showBackArrow = true,
    }: DrillInBreadcrumbProps) => {
        return (
            <div className="flex items-center gap-1 flex-wrap min-h-[32px] sticky top-0 bg-white z-10 py-2">
                {prefix}
                {showBackArrow && currentPath.length > 0 && (
                    <Button
                        type="text"
                        size="small"
                        icon={<ArrowLeft size={14} />}
                        onClick={onNavigateBack}
                        className="!px-2"
                    />
                )}
                {renderRoot ? (
                    renderRoot()
                ) : (
                    <button
                        type="button"
                        onClick={() => onNavigateToIndex(0)}
                        className={`px-2 py-1 rounded hover:bg-gray-100 transition-colors bg-transparent border-none cursor-pointer ${currentPath.length === 0 ? "font-semibold text-gray-900" : "text-gray-500"}`}
                    >
                        {rootTitle}
                    </button>
                )}
                {currentPath.map((segment, index) => (
                    <div key={index} className="flex items-center">
                        <CaretRight size={12} className="text-gray-400" />
                        <button
                            type="button"
                            onClick={() => onNavigateToIndex(index + 1)}
                            className={`px-2 py-1 rounded hover:bg-gray-100 transition-colors bg-transparent border-none cursor-pointer ${index === currentPath.length - 1 ? "font-semibold text-gray-900" : "text-gray-500"}`}
                        >
                            {segment}
                        </button>
                    </div>
                ))}
            </div>
        )
    },
)

DrillInBreadcrumb.displayName = "DrillInBreadcrumb"

export default DrillInBreadcrumb
