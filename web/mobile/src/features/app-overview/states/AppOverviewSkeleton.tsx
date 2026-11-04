import {Skeleton} from "@agenta/ui/ui"

const TableSkeleton = () => <Skeleton className="h-[220px] w-full rounded-lg" />

/** The final layout in grey: the title row, three environment cards, and three tables. */
export const AppOverviewSkeleton = () => (
    <div className="flex flex-col gap-8" aria-label="Loading app overview">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-[104px] w-full rounded-lg" />
            ))}
        </div>
        <TableSkeleton />
        <TableSkeleton />
        <TableSkeleton />
    </div>
)
