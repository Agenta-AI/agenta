import {forwardRef, memo, useCallback, useState} from "react"

import {CaretLineDown, CaretLineUp} from "@phosphor-icons/react"
import clsx from "clsx"
import {atom, useAtom} from "jotai"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import useResizeObserver from "@/oss/hooks/useResizeObserver"
import {EnhancedButtonProps} from "../EnhancedUIs/Button/types"

// Global jotai store that keeps the expanded/collapsed state for each individual cell.
// The key must be STABLE between mounts (e.g. scenarioId + stepKey + path) so that when
// a row is unmounted/remounted by react-window, the UI preserves its previous state.
export const expandedCellStateAtom = atom<Record<string, boolean>>({})
interface ExpandableProps {
    /**
     * Stable identifier for the cell. If omitted, the component falls back to local state.
     */
    disableExpand?: boolean
    expandKey?: string
    className?: string
    children: React.ReactNode
    buttonProps?: EnhancedButtonProps
}

export const ExpandableCell = forwardRef(
    (
        {children, className, expandKey, disableExpand, buttonProps, ...props}: ExpandableProps,
        forwardedRef,
    ) => {
        // Local overflow calculation is still component-local because it depends on DOM size.
        const [hasOverflow, setHasOverflow] = useState(false)

        // Global or local expanded state depending on expandKey presence
        const [expandedMap, setExpandedMap] = useAtom(expandedCellStateAtom)
        const expandedLocalState = useState(false)
        const expanded = expandKey ? (expandedMap[expandKey] ?? false) : expandedLocalState[0]
        const setExpanded = useCallback(
            (value: boolean | ((prev: boolean) => boolean)) => {
                if (expandKey) {
                    setExpandedMap((prev) => {
                        const nextVal =
                            typeof value === "function" ? value(prev[expandKey] ?? false) : value
                        return {...prev, [expandKey]: nextVal}
                    })
                } else {
                    // @ts-expect-error – tuple type
                    expandedLocalState[1](value)
                }
            },
            [expandKey, setExpandedMap, expandedLocalState],
        )

        const ref = useResizeObserver(
            useCallback((rect: ResizeObserverEntry["contentRect"], element?: HTMLElement) => {
                if (!element) return
                setHasOverflow((prev) => {
                    const firstChild = element.firstElementChild as HTMLElement | null
                    const next =
                        element.scrollHeight > rect.height ||
                        (firstChild?.offsetHeight ?? 0) > rect.height
                    return next !== prev ? next : prev
                })
            }, []),
        )

        const toggleExpanded = useCallback(
            (e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                setExpanded((prev: boolean) => !prev)
            },
            [setExpanded],
        )

        return (
            <div
                className="table-cell-expandable relative w-full h-full"
                ref={forwardedRef}
                {...props}
            >
                {/* Content container */}
                <div
                    ref={ref}
                    className={clsx(
                        className,
                        "cell-expand-container",
                        "relative w-full mb-2 transition-all duration-300 ease-linear overflow-hidden",
                        {
                            "max-h-[120px]": !expanded,
                            "h-fit": expanded,
                        },
                    )}
                >
                    {children}
                </div>

                {/* Expand/Collapse button */}
                {(hasOverflow || expanded) && (
                    <EnhancedButton
                        {...buttonProps}
                        className={clsx([
                            "absolute top-0 right-0 z-[1] hidden group-hover:block",
                            buttonProps?.className,
                        ])}
                        onClick={toggleExpanded}
                        size="small"
                        icon={
                            expanded ? (
                                <CaretLineUp size={14} className="mt-[1.5px] ml-[0.5px]" />
                            ) : (
                                <CaretLineDown size={14} className="mt-[1.5px] ml-[0.5px]" />
                            )
                        }
                        tooltipProps={{title: expanded ? "Collapse" : "Expand"}}
                    />
                )}
            </div>
        )
    },
)

ExpandableCell.displayName = "ExpandableCell"

export const Expandable = memo(
    ({disableExpand, ...props}: {disableExpand?: boolean; children: React.ReactNode}) => {
        if (disableExpand) {
            return props.children
        }
        return <ExpandableCell {...props} />
    },
)
