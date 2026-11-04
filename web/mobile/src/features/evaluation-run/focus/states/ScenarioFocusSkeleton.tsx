import {SkeletonBlock} from "@agenta/ui/ui"

/** The focus drawer while its scenario loads: the three sections in outline. */
export const ScenarioFocusSkeleton = () => (
    <div aria-busy="true" aria-label="Loading scenario" className="flex flex-col gap-4 p-4">
        <SkeletonBlock active className="h-20 w-full rounded-md" />
        <SkeletonBlock active className="h-28 w-full rounded-md" />
        <SkeletonBlock active className="h-16 w-full rounded-md" />
    </div>
)
