import {useId, useLayoutEffect, useState} from "react"

import {isDescriptionTruncatable} from "../integrationPolicy"

/**
 * A description that clamps, and offers Show more only when clamping actually hid something.
 *
 * Extracted from the integration permission drawer's tool rows, which is where the behaviour was
 * worked out, so every agent-config surface that shows a long description behaves the same:
 *
 *  • The toggle appears only when text is really hidden. A row measures itself while COLLAPSED,
 *    because expanding changes the very box the measurement reads.
 *  • A description with a newline is always expandable. No size measurement can see text a line
 *    break hid.
 *  • No description means no toggle. A row reused for a new item keeps the old measurement, and
 *    without this rule it grew a toggle over nothing.
 */
/** Literal class names: Tailwind scans source text, so a `line-clamp-${n}` built at runtime is
 *  never generated. Add a row here to support another clamp. */
const CLAMP: Record<number, string> = {
    1: "truncate",
    2: "line-clamp-2",
    3: "line-clamp-3",
}

export interface ExpandableDescriptionProps {
    description?: string
    /** Lines to clamp to while collapsed. 1 truncates on width; 2 or more clamp on height. */
    lines?: number
    /** Applied to the text in both states. */
    className?: string
    /** Added to the text once expanded, for surfaces that also tint the open state. */
    expandedClassName?: string
    /** Told whether the description is open, for a parent that restyles its own row. */
    onExpandedChange?: (expanded: boolean) => void
    /** Names what the toggle expands, e.g. the row's title. Without it a list of identical
     *  "Show more" buttons is unusable with a screen reader. */
    label?: string
}

export function ExpandableDescription({
    description,
    lines = 1,
    className = "text-xs text-[var(--ag-colorTextTertiary)]",
    expandedClassName = "whitespace-pre-line leading-relaxed text-[var(--ag-colorTextSecondary)]",
    onExpandedChange,
    label,
}: ExpandableDescriptionProps) {
    const textId = useId()
    const [expanded, setExpandedState] = useState(false)
    const [preview, setPreview] = useState<HTMLSpanElement | null>(null)
    const [overflows, setOverflows] = useState(false)
    const text = description?.trim()

    // Measured only while collapsed, and on the axis the clamp actually acts on: a one-line clamp
    // hides text sideways, a multi-line clamp hides it downwards.
    useLayoutEffect(() => {
        if (!text) {
            setOverflows(false)
            return
        }
        if (!preview || expanded) return
        const measure = () =>
            setOverflows(
                lines > 1
                    ? preview.scrollHeight > preview.clientHeight + 1
                    : preview.scrollWidth > preview.clientWidth,
            )
        measure()
        // Re-measure on resize: the answer depends on the element's own box, so a drawer that
        // opens at another width, or a panel the user drags, would otherwise keep the first one.
        if (typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(measure)
        observer.observe(preview)
        return () => observer.disconnect()
    }, [preview, expanded, text, lines])

    const setExpanded = (next: boolean) => {
        setExpandedState(next)
        onExpandedChange?.(next)
    }

    if (!text) return null

    const truncatable = isDescriptionTruncatable(text, overflows)
    const clamp = CLAMP[lines] ?? CLAMP[1]

    return (
        <>
            <span
                id={textId}
                ref={setPreview}
                className={`${className} ${expanded ? expandedClassName : clamp}`}
            >
                {text}
            </span>
            {truncatable ? (
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={textId}
                    aria-label={
                        label ? `${expanded ? "Show less" : "Show more"} about ${label}` : undefined
                    }
                    onClick={(event) => {
                        // Rows whose whole surface is clickable must not also toggle on this.
                        event.stopPropagation()
                        setExpanded(!expanded)
                    }}
                    className="mt-1 w-fit cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--ag-colorLink)]"
                >
                    {expanded ? "Show less" : "Show more"}
                </button>
            ) : null}
        </>
    )
}
