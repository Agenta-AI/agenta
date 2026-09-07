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
        className={`border-border flex w-full items-center gap-3 rounded-lg border p-3 no-underline ${ROW_LINK}`}
    >
        <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
            <ClockCounterClockwise aria-hidden size={18} className="text-muted-foreground" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-foreground text-sm font-medium">Run history</span>
            {caption ? (
                <span className="text-muted-foreground truncate text-xs">{caption}</span>
            ) : null}
        </span>
        <CaretRight aria-hidden size={16} className="text-muted-foreground shrink-0" />
    </Link>
)
