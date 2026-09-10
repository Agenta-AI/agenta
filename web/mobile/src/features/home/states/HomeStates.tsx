import {Skeleton} from "@/components/ui/skeleton"

/** Row geometry, not a spinner: the real rows replace these without shifting the list. */
export const HomeListSkeleton = () => (
    <div className="flex flex-col gap-0.5">
        {[70, 55, 62, 48, 58].map((width, index) => (
            <div key={index} className="flex items-center gap-3.5 px-3.5 py-2">
                <Skeleton className="size-[34px] shrink-0 rounded-[10px]" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3" style={{width: `${width}%`}} />
                </div>
            </div>
        ))}
    </div>
)

// Left-aligned on purpose: the hint stands in for rows, so it keeps the list's reading axis
// instead of floating mid-column.
export const HomeSectionEmpty = ({text}: {text: string}) => (
    <p className="text-muted-foreground px-3.5 py-6 text-xs">{text}</p>
)

export const HomeListError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-start gap-2 px-3.5 py-6">
        <p className="text-muted-foreground m-0 text-xs">Couldn&apos;t load your agents.</p>
        <button
            type="button"
            onClick={onRetry}
            className="text-foreground hover:bg-accent rounded-control-sm border-border focus-visible:border-ring focus-visible:ring-ring/50 box-border cursor-pointer appearance-none border border-solid bg-transparent px-2 py-1 font-[inherit] text-xs outline-none focus-visible:ring-[3px]"
        >
            Try again
        </button>
    </div>
)
