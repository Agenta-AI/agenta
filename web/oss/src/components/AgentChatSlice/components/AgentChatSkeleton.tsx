import {Skeleton} from "antd"

/**
 * Structural placeholder for the agent chat pane, shown in the two gaps before the real panel
 * can mount: (1) the workflow revision is still resolving the agent flag, (2) the lazy
 * AgentChatPanel chunk (AI SDK) is still loading. Mirrors the real layout — session tab strip
 * with trailing actions, transcript turns (user bubble + avatar right, assistant avatar + text
 * lines left), composer — so the pane reads as "chat, loading" instead of sitting black and
 * popping in all at once.
 */
const AgentChatSkeleton = () => (
    <div className="flex h-full w-full flex-col" aria-busy aria-label="Loading conversation">
        {/* Session tab strip: tab pills left, add/search/history actions right */}
        <div className="flex items-center gap-3 px-4 py-3">
            <Skeleton.Button active style={{width: 210, height: 40, borderRadius: 10}} />
            <Skeleton.Button active style={{width: 250, height: 40, borderRadius: 10}} />
            <div className="ml-auto flex items-center gap-3">
                <Skeleton.Avatar active size={26} shape="circle" />
                <Skeleton.Avatar active size={26} shape="circle" />
                <Skeleton.Avatar active size={26} shape="circle" />
            </div>
        </div>
        {/* Transcript column — same width cap as the real chat (CHAT_COLUMN) */}
        <div className="mx-auto flex min-h-0 w-full max-w-[880px] flex-1 flex-col gap-10 overflow-hidden p-3 pt-10">
            {/* User turn: bubble justified right with the avatar outside it */}
            <div className="flex items-start justify-end gap-3">
                <div className="w-[70%] max-w-[560px]">
                    <Skeleton.Button active block style={{height: 104, borderRadius: 24}} />
                </div>
                <Skeleton.Avatar active size={36} shape="circle" />
            </div>
            {/* Assistant turn: square avatar left, plain text lines (no bubble) */}
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
            {/* Second, shorter exchange */}
            <div className="flex items-start justify-end gap-3">
                <Skeleton.Button active style={{width: 320, height: 48, borderRadius: 24}} />
                <Skeleton.Avatar active size={36} shape="circle" />
            </div>
            <div className="flex items-start gap-3">
                <Skeleton.Avatar active size={36} shape="square" />
                <div className="min-w-0 flex-1 pt-1.5">
                    <Skeleton active title={false} paragraph={{rows: 2, width: ["64%", "42%"]}} />
                </div>
            </div>
        </div>
        {/* Composer (input area + toolbar lane) */}
        <div className="mx-auto w-full max-w-[880px] px-3 pb-4">
            <Skeleton.Button active block style={{height: 140, borderRadius: 16}} />
        </div>
    </div>
)

export default AgentChatSkeleton
