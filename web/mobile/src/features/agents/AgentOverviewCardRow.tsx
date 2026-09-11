import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

/** A rail card's row: a mark, a label, and the fact at the right. Rows bleed 8px into the card's padding so the hover fill has room. */
export const AgentOverviewCardRow = ({
    icon,
    label,
    detail,
    onClick,
    title,
    className,
}: {
    icon: ReactNode
    label: ReactNode
    /** The fact on the right — text, or a run of marks. */
    detail?: ReactNode
    /** Absent ⇒ the row is a fact, not a control. */
    onClick?: () => void
    title?: string
    className?: string
}) => {
    const body = (
        <>
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {icon}
            </span>
            {/* The label takes what the fact leaves: a long file or automation name truncates,
                while a long model id stops at just over half the row so the label stays whole. */}
            <span className="min-w-0 flex-1 truncate text-left text-[14px] text-foreground">
                {label}
            </span>
            {typeof detail === "string" ? (
                <span className="max-w-[55%] shrink-0 truncate text-right text-[13px] text-muted-foreground">
                    {detail}
                </span>
            ) : detail ? (
                <span className="flex shrink-0 items-center justify-end">{detail}</span>
            ) : null}
        </>
    )
    const shared = cn(
        "-mx-2 box-border flex w-[calc(100%+16px)] items-center gap-3 rounded-lg px-2 py-[7px]",
        className,
    )
    // A div with the button role, not a <button>: the Integrations row's fact is a list of
    // marks, which a real button cannot contain. Enter and Space still open it.
    return onClick ? (
        <div
            role="button"
            tabIndex={0}
            title={title}
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onClick()
                }
            }}
            className={cn(
                shared,
                "cursor-pointer outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
            )}
        >
            {body}
        </div>
    ) : (
        <div title={title} className={shared}>
            {body}
        </div>
    )
}
