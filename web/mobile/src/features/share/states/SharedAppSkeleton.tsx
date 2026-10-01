import {Skeleton} from "@agenta/ui/ui"

/** The app area while the snapshot loads, filling the same canvas the app will. */
export const SharedAppSkeleton = () => (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="min-h-0 w-full flex-1" />
    </div>
)
