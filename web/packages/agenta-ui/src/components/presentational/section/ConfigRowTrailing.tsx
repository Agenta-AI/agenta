/**
 * ConfigRowTrailing — the trailing-edge convention every config panel row follows.
 *
 * The agent playground's config pane stacks three kinds of row built by different components:
 * region header bars (Configuration / Triggers / Files), accordion section headers (Model,
 * Instructions, Integrations…) and nested item cards. Each ended on its own axis, so the pane's
 * right-hand column read ragged.
 *
 * Rows that carry an affordance now reserve the same fixed-width column for it — empty when the
 * row has none — so summaries end on one axis and carets/locks/folders on another.
 *
 * @example
 * ```tsx
 * <ConfigRowTrailing affordance={<ConfigRowCaret open={isOpen} />}>
 *   <span>{summary}</span>
 * </ConfigRowTrailing>
 * ```
 */
import type {ReactNode} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"

import {cn} from "../../../utils/styles"

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

/**
 * The collapse/expand (or drawer) caret for a config row.
 *
 * Both phosphor carets draw their ink inset from their own box, by different amounts (2.2px down,
 * 3.9px right at 14px), so a bare glyph lands off the column's axis and MOVES when the row toggles.
 * The transforms cancel exactly that, putting both ink edges on the column edge; keep them here
 * rather than at call sites.
 */
export function ConfigRowCaret({open = false, className}: {open?: boolean; className?: string}) {
    const cls = cn("text-[var(--ag-zinc-5)]", className)
    return open ? (
        <CaretDown size={AFFORDANCE_SIZE} className={cn("translate-x-[2.2px]", cls)} />
    ) : (
        <CaretRight size={AFFORDANCE_SIZE} className={cn("translate-x-[3.9px]", cls)} />
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
