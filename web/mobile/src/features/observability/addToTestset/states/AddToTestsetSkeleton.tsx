import {SkeletonBlock} from "@agenta/ui/ui"

const Section = ({rows}: {rows: number}) => (
    <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-4 w-40" />
        <SkeletonBlock className="h-3 w-64 max-w-full" />
        {Array.from({length: rows}, (_, index) => (
            <SkeletonBlock key={index} className="h-8 w-full" />
        ))}
    </div>
)

/** The sheet body while the spans load: the target, the mapping rows and the preview. */
export const AddToTestsetSkeleton = () => (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading the spans">
        <Section rows={1} />
        <Section rows={2} />
        <Section rows={3} />
    </div>
)
