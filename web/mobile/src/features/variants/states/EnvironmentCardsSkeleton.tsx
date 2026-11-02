import {Skeleton} from "@agenta/ui/ui"

/** Three cards in the final geometry of the environment cards. */
export const EnvironmentCardsSkeleton = () => (
    <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        aria-label="Loading environments"
    >
        {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[104px] w-full rounded-lg" />
        ))}
    </div>
)
