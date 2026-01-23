/**
 * MoleculeDrillInBreadcrumb Component
 *
 * Breadcrumb navigation for drill-in view.
 * Uses context for state and slots for customization.
 */

import {Fragment, useCallback, useMemo} from "react"

import {ArrowLeft, ChevronRight} from "lucide-react"

import type {BreadcrumbSlotProps} from "../types"

import {useDrillIn} from "./MoleculeDrillInContext"

// ============================================================================
// COMPONENT
// ============================================================================

export function MoleculeDrillInBreadcrumb() {
    const {
        currentPath,
        rootTitle,
        navigateBack,
        navigateToIndex,
        showBackArrow,
        classNames,
        styles,
        slots,
    } = useDrillIn()

    const canGoBack = currentPath.length > 0

    // Build slot props
    const slotProps: BreadcrumbSlotProps = useMemo(
        () => ({
            path: currentPath,
            rootTitle,
            onNavigateToIndex: navigateToIndex,
            onNavigateBack: navigateBack,
            canGoBack,
        }),
        [currentPath, rootTitle, navigateToIndex, navigateBack, canGoBack],
    )

    // Default render function
    const defaultRender = useCallback(() => {
        return (
            <div className={classNames.breadcrumb} style={styles?.breadcrumb}>
                {/* Back arrow */}
                {showBackArrow && canGoBack && (
                    <button
                        type="button"
                        onClick={navigateBack}
                        className={classNames.breadcrumbBack}
                        aria-label="Go back"
                    >
                        <ArrowLeft size={16} />
                    </button>
                )}

                {/* Root */}
                <button
                    type="button"
                    onClick={() => navigateToIndex(0)}
                    className={classNames.breadcrumbItem}
                    style={styles?.breadcrumbItem}
                >
                    {rootTitle}
                </button>

                {/* Path segments */}
                {currentPath.map((segment, index) => (
                    <Fragment key={`${segment}-${index}`}>
                        <span className={classNames.breadcrumbSeparator}>
                            <ChevronRight size={14} />
                        </span>
                        <button
                            type="button"
                            onClick={() => navigateToIndex(index + 1)}
                            className={classNames.breadcrumbItem}
                            style={styles?.breadcrumbItem}
                        >
                            {segment}
                        </button>
                    </Fragment>
                ))}
            </div>
        )
    }, [
        currentPath,
        rootTitle,
        navigateBack,
        navigateToIndex,
        showBackArrow,
        canGoBack,
        classNames,
        styles,
    ])

    // Use slot if provided
    if (slots?.breadcrumb) {
        return <>{slots.breadcrumb(slotProps)}</>
    }

    return defaultRender()
}
