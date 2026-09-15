import {SkeletonBlock} from "@agenta/ui/ui"

import {mobileTurnRowClass} from "../turnRowClass"

import {ContentRail} from "@/components/ContentRail"
import {cn} from "@/lib/utils"

/**
 * The transcript's placeholder, drawn on the real turns' geometry so the conversation lands on
 * top of it without a shift: the same rail (880px, p-4, gap-3), the same row band (pb-6), a user
 * bubble at the right (34px, 85% cap), and an assistant turn as it actually reads — the
 * "Worked for" meta row, a run of tool steps, then paragraphs of 13/18px text. No avatar: the
 * transcript has none. Pinned to the bottom, where the newest turn is what the load reveals.
 *
 * Every bar is the shared `SkeletonBlock` (the antd-shaped shimmer), not a local pulse, so this
 * loads the way every other list in the app does.
 */

/** A 13px/18px text line: a 12px bar in an 18px box, so N lines stack at the real line pitch. */
const Line = ({className}: {className: string}) => (
    <span className="flex h-[18px] items-center">
        <SkeletonBlock active className={cn("h-3", className)} />
    </span>
)

/** A paragraph: lines at the text pitch, the last one short — as prose ends. */
const Paragraph = ({widths}: {widths: string[]}) => (
    <div className="flex flex-col">
        {widths.map((width, i) => (
            <Line key={i} className={width} />
        ))}
    </div>
)

/** A user turn: one filled bubble at the right edge, sized like a short prompt. */
const UserTurn = ({width}: {width: string}) => (
    <div className={cn(mobileTurnRowClass, "justify-end")}>
        {/* Width on the bubble itself: the real wrapper is content-sized, and a percentage
            inside it would resolve to nothing. */}
        <SkeletonBlock active shape="round" className={cn("h-[34px] max-w-[85%]", width)} />
    </div>
)

/** The "Worked for 27s ›" row: a 30px button band with a short label. */
const WorkedRow = () => (
    <div className="flex h-[30px] items-center">
        <SkeletonBlock active className="h-3 w-[114px]" />
    </div>
)

/** One tool step: the 28px row, a 13px glyph and its command. */
const ToolRow = ({width}: {width: string}) => (
    <div className="flex h-7 items-center gap-3.5 px-1.5">
        <SkeletonBlock active shape="circle" className="size-[13px] shrink-0" />
        <SkeletonBlock active className={cn("h-3", width)} />
    </div>
)

/** An assistant turn: meta row, optional steps, then prose — in the column's 12px rhythm. */
const AssistantTurn = ({steps = [], paragraphs}: {steps?: string[]; paragraphs: string[][]}) => (
    <div className={cn(mobileTurnRowClass, "justify-start")}>
        {/* Explicit width, not the real column's content-sizing: the line widths below are
            percentages, and prose fills the column anyway. */}
        <div className="flex w-full min-w-0 items-start gap-3 sm:w-[85%]">
            <div className="flex w-full min-w-0 flex-col gap-3 overflow-hidden">
                <WorkedRow />
                {steps.length ? (
                    <div className="flex flex-col gap-2">
                        {steps.map((width, i) => (
                            <ToolRow key={i} width={width} />
                        ))}
                    </div>
                ) : null}
                {paragraphs.map((widths, i) => (
                    <Paragraph key={i} widths={widths} />
                ))}
            </div>
        </div>
    </div>
)

export const ChatLoading = () => (
    <ContentRail
        className="flex grow flex-col justify-end gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        aria-busy
        aria-label="Loading conversation"
    >
        <UserTurn width="w-[420px]" />
        <AssistantTurn
            steps={["w-[440px] max-w-[70%]", "w-[400px] max-w-[64%]"]}
            paragraphs={[
                ["w-full", "w-[92%]", "w-[58%]"],
                ["w-[96%]", "w-[40%]"],
            ]}
        />
        <UserTurn width="w-[260px]" />
        <AssistantTurn paragraphs={[["w-full", "w-[88%]", "w-[71%]", "w-[33%]"]]} />
    </ContentRail>
)

/** Also covers history-unavailable — loadSessionMessages resolves null for both. */
export const ChatEmpty = () => (
    <p className="text-muted-foreground grow p-6 text-xs">
        No messages here — this session has no replayable history.
    </p>
)
