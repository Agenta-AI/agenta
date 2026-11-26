/** Loading rows in the shape of a CatalogListRow: a 48 px row, the 32 px Mark, a name and one line. */
import {SkeletonBlock} from "@agenta/ui/ui"

export function CatalogRowSkeleton({count = 6}: {count?: number}) {
    return (
        <div aria-hidden className="flex flex-col gap-2">
            {Array.from({length: count}).map((_, i) => (
                <div key={i} className="flex h-row-double items-center gap-3">
                    <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-3.5 w-1/3" />
                        <SkeletonBlock active className="h-3 w-2/3" />
                    </div>
                </div>
            ))}
        </div>
    )
}
