import {Skeleton} from "@/components/ui/skeleton"

// Mirrors TurnRow's geometry — 24px avatar, 85% cap, pb-8 between turns — so turns replace it
// without shifting. Alternates roles because a real transcript never opens with two same-side rows.
const LINE_WIDTHS = ["w-[220px]", "w-[176px]", "w-[132px]"]

const SkeletonTurn = ({isUser, lines}: {isUser: boolean; lines: number}) => (
    <div className={`flex items-start pb-8 ${isUser ? "justify-end" : "justify-start"}`}>
        {isUser ? null : <Skeleton className="mr-2 size-6 shrink-0 rounded-full" />}
        <div className="flex min-w-0 max-w-[85%] flex-col gap-2">
            {Array.from({length: lines}, (_, i) => (
                <Skeleton key={i} className={`h-3.5 max-w-full ${LINE_WIDTHS[i % 3]}`} />
            ))}
        </div>
    </div>
)

export const ChatLoading = () => (
    <div className="flex grow flex-col p-4" aria-busy aria-label="Loading conversation">
        <SkeletonTurn isUser lines={1} />
        <SkeletonTurn isUser={false} lines={3} />
        <SkeletonTurn isUser lines={1} />
        <SkeletonTurn isUser={false} lines={2} />
    </div>
)

/** Also covers history-unavailable — loadSessionMessages resolves null for both. */
export const ChatEmpty = () => (
    <p className="text-muted-foreground grow p-6 text-xs">
        No messages here — this session has no replayable history.
    </p>
)
