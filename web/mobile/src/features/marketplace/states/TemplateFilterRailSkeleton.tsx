import {SkeletonBlock} from "@agenta/ui/ui"

const ROWS = ["w-3/4", "w-2/3", "w-1/2", "w-3/5", "w-2/3", "w-1/3"]

/** The filter sidebar's rows while the catalog loads. */
export const TemplateFilterRailSkeleton = () => (
    <div aria-busy className="flex flex-col gap-2.5 px-2.5">
        <SkeletonBlock active className="h-3 w-20 rounded" />
        {ROWS.map((width, index) => (
            <SkeletonBlock key={index} active className={`h-5 rounded ${width}`} />
        ))}
    </div>
)
