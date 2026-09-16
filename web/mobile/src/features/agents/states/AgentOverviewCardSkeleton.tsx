import {Skeleton} from "@/components/ui/skeleton"

/** Rows in flight, at the row's own 34px rhythm so the facts land without a shift. */
export const AgentOverviewCardSkeleton = ({rows = 3}: {rows?: number}) => (
    <div className="flex flex-col gap-2 py-1.5">
        {Array.from({length: rows}, (_, index) => (
            <Skeleton key={index} className="h-[26px] w-full" />
        ))}
    </div>
)
