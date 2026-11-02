import {CaretRight, ClockCounterClockwise} from "@phosphor-icons/react"

import {ROW_LINK} from "./lib/interactive"

/**
 * The way out of the config and into what actually happened.
 *
 * A card rather than a list preview: the runs take the whole screen when opened, and a truncated
 * list here would answer neither "did it work" nor "what did it do".
 *
 * It opens a VIEW, not a route. The runs belong to the automation above them, so the URL stays on
 * it and the history's own back link returns here — one screen, two states.
 *
 * The design draws this two lines tall — a title over a run count. It collapses to a single row
 * until that count is wired, because a box sized for two lines holding one reads as padding
 * around nothing.
 */
export const AutomationRunHistoryCard = ({
    onOpen,
    caption = "",
}: {
    onOpen: () => void
    caption?: string
}) => (
    <button
        type="button"
        onClick={onOpen}
        className={`mt-[30px] flex w-full cursor-pointer items-center rounded-lg border border-solid border-border bg-transparent text-left ${caption ? "gap-3 px-3.5 py-2.5" : "gap-3 px-3.5 py-2"} ${ROW_LINK}`}
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
    </button>
)
