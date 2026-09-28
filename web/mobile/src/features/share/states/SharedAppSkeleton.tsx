import {Skeleton} from "@agenta/ui/ui"

/** The app area while the snapshot loads. */
export const SharedAppSkeleton = () => (
    <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-40 w-full" />
    </div>
)
