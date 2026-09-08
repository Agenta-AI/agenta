import {CaretRight, ClockCounterClockwise} from "@phosphor-icons/react"
import Link from "next/link"

import {ROW_LINK} from "./lib/interactive"

/**
 * The way out of the config screen and into what actually happened.
 *
 * A card rather than a list preview: runs are their own screen (W6), and a truncated list here
 * would answer neither "did it work" nor "what did it do".
 *
 * The design draws this two lines tall — a title over a run count. It collapses to a single row
 * until that count is wired, because a box sized for two lines holding one reads as padding
 * around nothing.
 */
export const AutomationRunHistoryCard = ({
    href,
    caption = "",
}: {
    href: string
    caption?: string
}) => (
    <Link
        href={href}
        className={`mt-[30px] flex w-full items-center rounded-lg border border-solid border-border no-underline ${caption ? "gap-3 px-3.5 py-2.5" : "gap-3 px-3.5 py-2"} ${ROW_LINK}`}
    >
        <span
            className={`flex shrink-0 items-center justify-center rounded-md bg-muted ${
                caption ? "size-7" : "size-6"
            }`}
        >
            <ClockCounterClockwise
                aria-hidden
                size={caption ? 15 : 14}
                className="text-muted-foreground"
            />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] font-medium text-foreground">Run history</span>
            {caption ? (
                <span className="truncate text-[13px] text-muted-foreground">{caption}</span>
            ) : null}
        </span>
        <CaretRight aria-hidden size={14} className="shrink-0 text-muted-foreground" />
    </Link>
)
