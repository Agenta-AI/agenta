/**
 * CollapseToggleButton
 *
 * Shared collapse/expand toggle button used across the application.
 * Provides consistent icon (CaretLineUp/CaretLineDown) and label (Expand/Collapse)
 * behavior for all collapsible content areas: messages, tools, variable inputs, etc.
 *
 * Also exports `useCollapseToggle` hook for managing collapse state with
 * a consistent API.
 */

import {useCallback, useEffect, useState} from "react"

import {CaretLineDown, CaretLineUp} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

// ============================================================================
// HOOK
// ============================================================================

export interface UseCollapseToggleOptions {
    /** Initial collapsed state (default: false = expanded) */
    defaultCollapsed?: boolean
}

export interface UseCollapseToggleReturn {
    /** Whether the content is currently collapsed */
    collapsed: boolean
    /** Toggle the collapsed state */
    toggle: () => void
    /** Set collapsed state directly */
    setCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void
    /** Tooltip label for the toggle button ("Expand" or "Collapse") */
    label: string
    /** Icon element for the toggle button */
    icon: React.ReactElement
}

/**
 * Hook for managing collapse/expand state with consistent labels and icons.
 *
 * @example
 * ```tsx
 * const {collapsed, toggle, label, icon} = useCollapseToggle()
 * return <Button icon={icon} onClick={toggle} />
 * ```
 */
export function useCollapseToggle(options: UseCollapseToggleOptions = {}): UseCollapseToggleReturn {
    const {defaultCollapsed = false} = options
    const [collapsed, setCollapsed] = useState(defaultCollapsed)

    const toggle = useCallback(() => {
        setCollapsed((prev) => !prev)
    }, [])

    return {
        collapsed,
        toggle,
        setCollapsed,
        label: collapsed ? "Expand" : "Collapse",
        icon: collapsed ? <CaretLineDown size={14} /> : <CaretLineUp size={14} />,
    }
}

/**
 * Returns the appropriate icon element for a given collapsed state.
 * Use this when you manage state externally but need the canonical icon.
 */
export function getCollapseIcon(collapsed: boolean, size = 14): React.ReactElement {
    return collapsed ? <CaretLineDown size={size} /> : <CaretLineUp size={size} />
}

/**
 * Returns the appropriate label for a given collapsed state.
 * Use this when you manage state externally but need the canonical label.
 */
export function getCollapseLabel(collapsed: boolean): string {
    return collapsed ? "Expand" : "Collapse"
}

// ============================================================================
// OVERFLOW DETECTION
// ============================================================================

/**
 * Lightweight hook that tracks whether an element's content overflows its
 * visible area. Uses a single ResizeObserver — no polling.
 *
 * @param ref - Ref to a container element
 * @param childSelector - Optional CSS selector to find the actual scrollable
 *   child within the container (e.g. `".agenta-editor-wrapper"`). When omitted,
 *   the ref element itself is checked.
 * @returns `true` when `scrollHeight > clientHeight`
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null)
 * const overflows = useContentOverflow(ref, ".agenta-editor-wrapper")
 * ```
 */
export function useContentOverflow(
    ref: React.RefObject<HTMLElement | null>,
    childSelector?: string,
): boolean {
    const [overflows, setOverflows] = useState(false)

    useEffect(() => {
        const root = ref.current
        if (!root) return

        const resolve = () =>
            childSelector ? root.querySelector<HTMLElement>(childSelector) : root

        const check = () => {
            const el = resolve()
            if (el) setOverflows(el.scrollHeight > el.clientHeight)
        }
        check()

        const ro = new ResizeObserver(check)
        ro.observe(root)
        return () => ro.disconnect()
    }, [ref, childSelector])

    return overflows
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface CollapseToggleButtonProps {
    /** Whether the content is currently collapsed */
    collapsed: boolean
    /** Called when the button is clicked */
    onToggle?: () => void
    /** Whether the button is disabled */
    disabled?: boolean
    /**
     * Optional ref to the collapsible content container.
     * When provided, the button auto-disables if the content fits
     * within the container without overflow (nothing to collapse).
     */
    contentRef?: React.RefObject<HTMLElement | null>
    /**
     * CSS selector for the scrollable child within contentRef.
     * Defaults to `".agenta-editor-wrapper"` when contentRef is provided.
     */
    childSelector?: string
    /** Additional CSS class */
    className?: string
    /** Button size (default: "small") */
    size?: "small" | "middle" | "large"
    /** Icon size in pixels (default: 14) */
    iconSize?: number
}

/**
 * Shared collapse/expand toggle button.
 *
 * Uses CaretLineUp (expanded) / CaretLineDown (collapsed) icons
 * with "Collapse" / "Expand" tooltip labels.
 *
 * When `contentRef` is provided, the button auto-disables if the
 * content doesn't overflow (nothing to collapse).
 */
export default function CollapseToggleButton({
    collapsed,
    onToggle,
    disabled,
    contentRef,
    childSelector,
    className,
    size = "small",
    iconSize = 14,
}: CollapseToggleButtonProps) {
    const effectiveSelector = contentRef ? (childSelector ?? ".agenta-editor-wrapper") : undefined
    const overflows = useContentOverflow(contentRef ?? {current: null}, effectiveSelector)
    const isDisabled = disabled || (contentRef ? !overflows && !collapsed : false)

    return (
        <Tooltip title={getCollapseLabel(collapsed)}>
            <Button
                size={size}
                type="text"
                className={className}
                onClick={onToggle}
                disabled={isDisabled}
                icon={getCollapseIcon(collapsed, iconSize)}
            />
        </Tooltip>
    )
}
