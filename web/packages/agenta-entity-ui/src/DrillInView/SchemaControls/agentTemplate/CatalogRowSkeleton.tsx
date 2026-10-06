/** Loading rows in the shape of a CatalogListRow: the logo tile, a name and one line under it. */
import {SkeletonBlock} from "@agenta/ui/ui"

export function CatalogRowSkeleton({count = 6}: {count?: number}) {
    return (
        <div aria-hidden className="flex flex-col">
            {Array.from({length: count}).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 py-2">
                    <SkeletonBlock active className="size-8 shrink-0 rounded-lg" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-3.5 w-1/3 rounded" />
                        <SkeletonBlock active className="h-3 w-2/3 rounded" />
                    </div>
                </div>
            ))}
        </div>
    )
}
