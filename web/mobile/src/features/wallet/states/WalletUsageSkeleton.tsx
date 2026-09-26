import {Skeleton} from "@/components/ui/skeleton"

/** Mirrors the tab: the balance tiles, the daily bars, then the session rows. */
export const WalletUsageSkeleton = () => (
    <div className="flex flex-col gap-6" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({length: 4}, (_, index) => (
                <Skeleton key={index} className="h-16" />
            ))}
        </div>
        <Skeleton className="h-32" />
        <div className="flex flex-col gap-2">
            {Array.from({length: 4}, (_, index) => (
                <Skeleton key={index} className="h-10" />
            ))}
        </div>
    </div>
)
