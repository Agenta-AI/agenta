import {SkeletonAvatar, SkeletonBlock} from "@agenta/ui/ui"

/**
 * Region skeletons for the agent chat pane. Each region (session bar / transcript /
 * composer) exports its own skeleton, and the pane-level default composes them — so the
 * pre-panel loading gates and each lazy region's Suspense fallback render the SAME
 * component, and a region hydrating never shifts or restyles its neighbours.
 */

/** A run of shimmering text lines (the antd `Skeleton paragraph` shape). */
const SkeletonLines = ({widths}: {widths: string[]}) => (
    <div className="flex flex-col gap-3" aria-hidden>
        {widths.map((width, i) => (
            <SkeletonBlock key={i} active className="h-3.5 rounded" style={{width}} />
        ))}
    </div>
)

/** Session tab strip: tab pills left, add/search/history actions right. Matches the
 * real bar's 48px lane and h-7 pills. */
export const SessionBarSkeleton = () => (
    <div className="flex h-12 w-full items-center gap-2 px-4">
        <SkeletonBlock active className="h-7 w-[150px] rounded-md" />
        <SkeletonBlock active className="h-7 w-[120px] rounded-md" />
        <div className="ml-auto flex items-center gap-3">
            <SkeletonAvatar active className="size-[22px]" />
            <SkeletonAvatar active className="size-[22px]" />
            <SkeletonAvatar active className="size-[22px]" />
        </div>
    </div>
)

/** Transcript column: user bubbles (content-hugging, avatar outside) alternating with
 * assistant turns (square avatar + bare text lines). Same 880px cap as CHAT_COLUMN. */
export const TranscriptSkeleton = () => (
    <div className="mx-auto flex min-h-0 w-full max-w-[880px] flex-1 flex-col gap-8 overflow-hidden p-3 pt-10">
        <div className="flex items-start justify-end gap-3">
            <div className="w-[45%] max-w-[420px]">
                <SkeletonBlock active className="h-[72px] w-full rounded-[20px]" />
            </div>
            <SkeletonAvatar active className="size-9" />
        </div>
        <div className="flex items-start gap-3">
            <SkeletonAvatar active shape="square" className="size-9" />
            <div className="min-w-0 flex-1 pt-1.5">
                <SkeletonLines widths={["30%", "58%", "62%", "38%"]} />
            </div>
        </div>
        <div className="flex items-start justify-end gap-3">
            <SkeletonBlock active className="h-11 w-[180px] rounded-[20px]" />
            <SkeletonAvatar active className="size-9" />
        </div>
        <div className="flex items-start gap-3">
            <SkeletonAvatar active shape="square" className="size-9" />
            <div className="min-w-0 flex-1 pt-1.5">
                <SkeletonLines widths={["64%", "42%"]} />
            </div>
        </div>
    </div>
)

/** Composer box — measured 114px tall, rounded-lg (8px) in the live panel. The caller
 * supplies the column/margin classes so it can sit in either the pane skeleton's gutter
 * or the real composer's slot (`CHAT_COLUMN mb-3`). */
export const ComposerSkeleton = ({className}: {className?: string}) => (
    <div className={className}>
        <SkeletonBlock active className="h-[114px] w-full rounded-lg" />
    </div>
)

/**
 * Conversation-body placeholder: transcript + composer, WITHOUT the session bar (the frame owns
 * that region separately). This is the Suspense fallback the synchronous panel frame reserves for
 * each tab while the lazy `AgentConversation` chunk loads — so the frame's real structure paints
 * immediately and only the body fills in behind this.
 */
export const ConversationSkeleton = () => (
    <div
        className="ag-canvas flex h-full min-h-0 w-full flex-col"
        aria-busy
        aria-label="Loading conversation"
    >
        <TranscriptSkeleton />
        <div className="w-full px-3 pb-3">
            <ComposerSkeleton className="mx-auto w-full max-w-[880px]" />
        </div>
    </div>
)

/**
 * Whole-pane placeholder (bar + transcript + composer), shown at ONE gate: the workflow revision
 * is still resolving the agent flag, so it's not yet confirmed to be an agent and the live panel
 * must not mount. Once confirmed, the frame renders directly (no crossfade overlay).
 */
const AgentChatSkeleton = () => (
    <div className="flex h-full w-full flex-col" aria-busy aria-label="Loading conversation">
        <SessionBarSkeleton />
        <TranscriptSkeleton />
        <div className="w-full px-3 pb-3">
            <ComposerSkeleton className="mx-auto w-full max-w-[880px]" />
        </div>
    </div>
)

export default AgentChatSkeleton
