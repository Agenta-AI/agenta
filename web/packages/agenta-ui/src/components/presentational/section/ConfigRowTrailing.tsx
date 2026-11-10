/**
 * The trailing cluster of a config-panel row: content (summary, `+`, count), then an optional
 * fixed 14px affordance column for a lock or a glyph a placeholder stands in for. Carets do
 * not live here: a section header puts its caret right after the title.
 */
import type {ReactNode} from "react"

import {cn} from "../../../utils/styles"

/** The 14px affordance column. Renders empty under `reserve` when there is no affordance. */
function ConfigRowAffordance({children, className}: {children?: ReactNode; className?: string}) {
    return (
        <span
            aria-hidden={children ? undefined : true}
            className={cn("flex h-[14px] w-[14px] shrink-0 items-center justify-end", className)}
        >
            {children}
        </span>
    )
}

export interface ConfigRowTrailingProps {
    /** Content before the affordance column — summary text, a `+` button, a count, tags. */
    children?: ReactNode
    /** The row's lock or other trailing glyph. */
    affordance?: ReactNode
    /** Keep the column when there is no affordance (e.g. a skeleton holding a glyph's place). */
    reserve?: boolean
    /** Extra classes for the cluster (e.g. `min-w-0` when the row lets its summary truncate). */
    className?: string
}

/** A config row's trailing cluster: content, then the affordance column when there is one. */
export function ConfigRowTrailing({
    children,
    affordance,
    reserve = false,
    className,
}: ConfigRowTrailingProps) {
    return (
        <div className={cn("flex items-center gap-2", className)}>
            {children}
            {affordance || reserve ? <ConfigRowAffordance>{affordance}</ConfigRowAffordance> : null}
        </div>
    )
}

/**
 * The geometry every config-panel region header shares, fill excluded, so the Configuration,
 * Triggers and Files bars cannot drift. No `w-full`: preflight is off on the desktop, so
 * `width:100%` plus the bar's own `px-4` overflows its parent by 32px.
 */
export const CONFIG_REGION_BAR =
    "h-[48px] flex items-center justify-between overflow-hidden border-b border-colorBorderSecondary py-2 px-4"
