import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

/** The rail card's action link: 13px, secondary, no chrome — a word at the title's right. */
const ACTION_CLASS =
    "m-0 shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 font-[inherit] text-[13px] leading-none text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"

/**
 * One card of the agent overview's rail — Configuration, Files, Automations. A soft fill on the
 * page, no border, so the three read as one column of the agent's own state rather than three
 * framed panels competing with the activity list beside them.
 */
export const AgentOverviewCard = ({
    title,
    action,
    onAction,
    children,
    className,
}: {
    title: string
    /** The one verb the card offers — "Edit", "Open drive". */
    action?: string
    onAction?: () => void
    children: ReactNode
    className?: string
}) => (
    <section className={cn("rounded-[10px] bg-muted/50 px-4 pb-2.5 pt-3.5", className)}>
        <div className="mb-1.5 flex items-center gap-2.5">
            <h2 className="m-0 min-w-0 flex-1 truncate text-[14px] font-medium leading-[1.4] text-foreground">
                {title}
            </h2>
            {action && onAction ? (
                <button type="button" onClick={onAction} className={ACTION_CLASS}>
                    {action}
                </button>
            ) : null}
        </div>
        {children}
    </section>
)
