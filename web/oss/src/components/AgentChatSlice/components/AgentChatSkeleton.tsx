import {Skeleton} from "antd"

/**
 * Region skeletons for the agent chat pane. Each region (session bar / transcript /
 * composer) exports its own skeleton, and the pane-level default composes them — so the
 * pre-panel loading gates and each lazy region's Suspense fallback render the SAME
 * component, and a region hydrating never shifts or restyles its neighbours.
 */

/** Session tab strip: tab pills left, add/search/history actions right. Matches the
 * real bar's 48px lane and h-7 pills. */
export const SessionBarSkeleton = () => (
    <div className="flex h-12 w-full items-center gap-2 px-4">
        <Skeleton.Button active style={{width: 150, height: 28, borderRadius: 6}} />
        <Skeleton.Button active style={{width: 120, height: 28, borderRadius: 6}} />
        <div className="ml-auto flex items-center gap-3">
            <Skeleton.Avatar active size={22} shape="circle" />
            <Skeleton.Avatar active size={22} shape="circle" />
            <Skeleton.Avatar active size={22} shape="circle" />
        </div>
    </div>
)

/** Transcript column: user bubbles (content-hugging, avatar outside) alternating with
 * assistant turns (square avatar + bare text lines). Same 880px cap as CHAT_COLUMN. */
export const TranscriptSkeleton = () => (
    <div className="mx-auto flex min-h-0 w-full max-w-[880px] flex-1 flex-col gap-8 overflow-hidden p-3 pt-10">
        <div className="flex items-start justify-end gap-3">
            <div className="w-[45%] max-w-[420px]">
                <Skeleton.Button active block style={{height: 72, borderRadius: 20}} />
            </div>
            <Skeleton.Avatar active size={36} shape="circle" />
        </div>
        <div className="flex items-start gap-3">
            <Skeleton.Avatar active size={36} shape="square" />
            <div className="min-w-0 flex-1 pt-1.5">
                <Skeleton
                    active
                    title={false}
                    paragraph={{rows: 4, width: ["30%", "58%", "62%", "38%"]}}
                />
            </div>
        </div>
        <div className="flex items-start justify-end gap-3">
            <Skeleton.Button active style={{width: 180, height: 44, borderRadius: 20}} />
            <Skeleton.Avatar active size={36} shape="circle" />
        </div>
        <div className="flex items-start gap-3">
            <Skeleton.Avatar active size={36} shape="square" />
            <div className="min-w-0 flex-1 pt-1.5">
                <Skeleton active title={false} paragraph={{rows: 2, width: ["64%", "42%"]}} />
            </div>
        </div>
    </div>
)

/** Composer box — measured 114px tall, rounded-lg (8px) in the live panel. The caller
 * supplies the column/margin classes so it can sit in either the pane skeleton's gutter
 * or the real composer's slot (`CHAT_COLUMN mb-3`). */
export const ComposerSkeleton = ({className}: {className?: string}) => (
    <div className={className}>
        <Skeleton.Button active block style={{height: 114, borderRadius: 8}} />
    </div>
)

/**
 * Whole-pane placeholder, shown before the panel itself can mount: (1) the workflow
 * revision is still resolving the agent flag, (2) the lazy AgentChatPanel chunk is
 * loading (the crossfade host keeps it as a dissolving overlay).
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
