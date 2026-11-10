/**
 * The trailing-edge convention every config-panel row follows: content, then one fixed-width
 * affordance column, so carets, locks and folders across three different row components land on
 * a single axis instead of each ending where its own glyph happens to sit.
 */
import type {ReactNode} from "react"

import {CaretRight} from "@phosphor-icons/react"

import {cn} from "../../../utils/styles"
import {CollapseCaret} from "../../ui/collapse-caret"

/** Side of the affordance column, in px — the phosphor caret box every config row ends with. */
const AFFORDANCE_SIZE = 14

/**
 * The reserved affordance column on its own, for rows that assemble their own trailing cluster.
 * Renders empty when there is no affordance, which is what keeps a caret-less row on the axis.
 */
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

/** A collapsible row's caret: the shared filled caret, turned down when open. */
export function ConfigRowCaret({open = false, className}: {open?: boolean; className?: string}) {
    return <CollapseCaret open={open} size={AFFORDANCE_SIZE} className={className} />
}

/** A row that opens a drawer: an outline caret, since navigation is not collapse. */
export function ConfigRowDrawerCaret({className}: {className?: string}) {
    return (
        <CaretRight
            aria-hidden
            size={AFFORDANCE_SIZE}
            className={cn("shrink-0 text-colorTextTertiary", className)}
        />
    )
}

export interface ConfigRowTrailingProps {
    /** Content before the affordance column — summary text, a `+` button, a count, tags. */
    children?: ReactNode
    /** The row's caret / lock / folder glyph. */
    affordance?: ReactNode
    /** Keep the column when there is no affordance. Off for rows that never carry one. */
    reserve?: boolean
    /** Extra classes for the cluster (e.g. `min-w-0` when the row lets its summary truncate). */
    className?: string
}

/** A config row's trailing cluster: content, then the reserved affordance column. */
export function ConfigRowTrailing({
    children,
    affordance,
    reserve = true,
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
