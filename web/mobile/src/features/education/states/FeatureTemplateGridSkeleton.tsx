import {SkeletonBlock} from "@agenta/ui/ui"

/** The template cards while the catalog loads, at the cards' own height and grid. */
export const FeatureTemplateGridSkeleton = ({count}: {count: number}) => (
    <div aria-busy className="grid gap-3 @2xl:grid-cols-3">
        {Array.from({length: count}, (_, index) => (
            <SkeletonBlock key={index} active className="h-[180px] w-full rounded-xl" />
        ))}
    </div>
)
