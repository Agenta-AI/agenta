/**
 * One row in a section card of the Configuration page (canvas A04): an icon tile, a title and a
 * secondary line. With `onClick` the row is a button with a caret; with `trailing` it holds a
 * control at the right instead (the Permissions policy select).
 */
import type {ReactNode} from "react"

import {cn} from "@agenta/ui/styles"
import {CollapseCaret} from "@agenta/ui/ui"

export interface SectionPageRowProps {
    icon?: ReactNode
    title: ReactNode
    summary?: ReactNode
    onClick?: () => void
    trailing?: ReactNode
}

// Rows of one card are divided by a line.
const ROW =
    "flex w-full items-center gap-3 border-0 border-t border-solid border-colorBorderSecondary px-3.5 py-3 text-left first:border-t-0"

export const SectionPageRow = ({icon, title, summary, onClick, trailing}: SectionPageRowProps) => {
    const body = (
        <>
            {icon ? (
                <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-md bg-colorFillTertiary text-colorTextSecondary"
                >
                    {icon}
                </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-colorText">{title}</span>
                {summary ? (
                    <span className="truncate text-[12px] leading-4 text-colorTextSecondary">
                        {summary}
                    </span>
                ) : null}
            </span>
        </>
    )
    if (onClick) {
        return (
            <button
                type="button"
                className={cn(
                    ROW,
                    "cursor-pointer bg-transparent font-[inherit] hover:bg-colorFillQuaternary",
                )}
                onClick={onClick}
            >
                {body}
                <CollapseCaret size={12} />
            </button>
        )
    }
    return (
        <div className={ROW}>
            {body}
            {trailing ? <span className="shrink-0">{trailing}</span> : null}
        </div>
    )
}
