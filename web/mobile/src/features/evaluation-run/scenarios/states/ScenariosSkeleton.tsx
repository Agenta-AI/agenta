import {SkeletonBlock} from "@agenta/ui/ui"

/** The Scenarios tab while its code loads: rows in the shape of the table. */
export const ScenariosSkeleton = () => (
    <div aria-busy="true" aria-label="Loading scenarios" className="flex flex-col gap-3">
        {Array.from({length: 5}, (_, row) => (
            <SkeletonBlock key={row} active className="h-12 w-full rounded-md" />
        ))}
    </div>
)
