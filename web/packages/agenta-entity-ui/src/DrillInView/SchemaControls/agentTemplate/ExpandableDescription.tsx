/** A description that clamps, and toggles open on click only when clamping really hid something. */
import {useId, useLayoutEffect, useState} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {touchTargetExpansion} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"

import {isDescriptionTruncatable} from "../integrationPolicy"

/** Literal class names: Tailwind never generates a `line-clamp-${n}` built at runtime. */
const CLAMP: Record<number, string> = {
    1: "truncate",
    2: "line-clamp-2",
}

const TEXT_CLASS = "text-xs text-[var(--ag-colorTextTertiary)]"
// 12 px: `text-xs` is 13 px in /m.
const CANVAS_TEXT_CLASS = "text-[12px] leading-5 text-[var(--ag-colorTextTertiary)]"
const EXPANDED_CLASS = "whitespace-pre-line leading-relaxed text-[var(--ag-colorTextSecondary)]"

export interface ExpandableDescriptionProps {
    description?: string
    /** Lines to clamp to while collapsed. 1 truncates on width; 2 or more clamp on height. */
    lines?: number
    /** Told whether the description is open, for a parent that restyles its own row. */
    onExpandedChange?: (expanded: boolean) => void
    /** Names what the toggle expands, so a list of Show more buttons stays distinguishable. */
    label?: string
    /**
     * The canvas tool line (F02 f6): 12/20, and the line itself is the toggle, with no caret.
     * Absent, the description keeps today's size and caret.
     */
    canvas?: boolean
    /** Show the whole text, with no clamp and no toggle (a phone, M09: "its line shows in full"). */
    full?: boolean
}

export function ExpandableDescription({
    description,
    lines = 1,
    onExpandedChange,
    label,
    canvas = false,
    full = false,
}: ExpandableDescriptionProps) {
    const t = useT(configItemsCatalog)
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
        if (!preview || expanded || full) return
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
    }, [preview, expanded, text, lines, full])

    const setExpanded = (next: boolean) => {
        setExpandedState(next)
        onExpandedChange?.(next)
    }

    if (!text) return null

    const truncatable = isDescriptionTruncatable(text, overflows)
    const clamp = CLAMP[lines] ?? CLAMP[1]

    const base = canvas ? CANVAS_TEXT_CLASS : TEXT_CLASS
    const textClass = `${base} ${full ? "whitespace-pre-line" : expanded ? EXPANDED_CLASS : clamp}`

    if (full || !truncatable) {
        return (
            <span id={textId} ref={setPreview} className={textClass}>
                {text}
            </span>
        )
    }

    // The description is its own toggle, with a caret, so a row spends no line on a link.
    return (
        <button
            type="button"
            aria-expanded={expanded}
            aria-controls={textId}
            aria-label={
                label
                    ? expanded
                        ? t("entityUi.configItems.showLessAbout", {label})
                        : t("entityUi.configItems.showMoreAbout", {label})
                    : undefined
            }
            onClick={(event) => {
                // Rows whose whole surface is clickable must not also toggle on this.
                event.stopPropagation()
                setExpanded(!expanded)
            }}
            // The invisible expansion carries the 24px floor to the 44px touch minimum.
            // The canvas line is 20 px (F02 f6: a 63 px tool row). It shows only at 768 px and up
            // (a phone shows the full text), where the 24 px expansion is a pointer convenience.
            className={`group/desc flex w-full min-w-0 cursor-pointer gap-1 border-0 bg-transparent p-0 text-left font-[inherit] ${canvas ? "min-h-5" : "min-h-control-xs"} ${expanded ? "items-start" : "items-center"} ${touchTargetExpansion({height: 24, border: 0})}`}
        >
            <span
                id={textId}
                ref={setPreview}
                className={`min-w-0 flex-1 transition-colors group-hover/desc:text-[var(--ag-colorTextSecondary)] ${textClass}`}
            >
                {text}
            </span>
            {canvas ? null : (
                <CaretDown
                    aria-hidden
                    size={10}
                    className={`shrink-0 text-[var(--ag-colorTextTertiary)] transition-transform ${
                        expanded ? "mt-[3px] rotate-180" : ""
                    }`}
                />
            )}
        </button>
    )
}
