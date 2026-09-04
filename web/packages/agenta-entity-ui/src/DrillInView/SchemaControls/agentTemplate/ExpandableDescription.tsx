/** A description that clamps, offering Show more only when clamping really hid something. */
import {useId, useLayoutEffect, useState} from "react"

import {isDescriptionTruncatable} from "../integrationPolicy"

/** Literal class names: Tailwind never generates a `line-clamp-${n}` built at runtime. */
const CLAMP: Record<number, string> = {
    1: "truncate",
    2: "line-clamp-2",
}

const TEXT_CLASS = "text-xs text-[var(--ag-colorTextTertiary)]"
const EXPANDED_CLASS = "whitespace-pre-line leading-relaxed text-[var(--ag-colorTextSecondary)]"

export interface ExpandableDescriptionProps {
    description?: string
    /** Lines to clamp to while collapsed. 1 truncates on width; 2 or more clamp on height. */
    lines?: number
    /** Told whether the description is open, for a parent that restyles its own row. */
    onExpandedChange?: (expanded: boolean) => void
    /** Names what the toggle expands, so a list of Show more buttons stays distinguishable. */
    label?: string
}

export function ExpandableDescription({
    description,
    lines = 1,
    onExpandedChange,
    label,
}: ExpandableDescriptionProps) {
    const textId = useId()
    const [expanded, setExpandedState] = useState(false)
    const [preview, setPreview] = useState<HTMLSpanElement | null>(null)
    const [overflows, setOverflows] = useState(false)
    const text = description?.trim()

    // Measured while collapsed, on the axis the clamp acts on: width for 1 line, height for 2+.
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
        // Resize-watch only a multi-line clamp: single-line lists are the long ones, and one
        // observer per row there costs more than the re-measure it would catch.
        if (lines < 2 || typeof ResizeObserver === "undefined") return
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
                className={`${TEXT_CLASS} ${expanded ? EXPANDED_CLASS : clamp}`}
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
