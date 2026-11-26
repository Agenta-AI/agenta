import {Skeleton} from "@agenta/ui/ui"

/** The settled layout in outline: the config block on the left, the details column beside it. */
export const RevisionDrawerSkeleton = () => (
    <div
        data-testid="revision-drawer-loading"
        className="flex min-h-0 flex-1 flex-col md:flex-row"
        aria-busy="true"
    >
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full" />
        </div>
        <div className="flex shrink-0 flex-col gap-3 p-4 md:w-72">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
        </div>
    </div>
)
