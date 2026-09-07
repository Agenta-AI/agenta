import {CaretRight, ClockCounterClockwise} from "@phosphor-icons/react"
import Link from "next/link"

import {ROW_LINK} from "@/lib/interactive"

/**
 * The way out of the config screen and into what actually happened.
 *
 * A card rather than a list preview: runs are their own screen (W6), and a truncated list here
 * would answer neither "did it work" nor "what did it do".
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
        className={`mt-[30px] flex w-full items-center gap-3.5 rounded-[11px] border border-solid border-border px-[18px] py-4 no-underline ${ROW_LINK}`}
    >
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-muted">
            <ClockCounterClockwise aria-hidden size={17} className="text-muted-foreground" />
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
