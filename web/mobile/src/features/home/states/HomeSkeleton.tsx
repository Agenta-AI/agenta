import {Skeleton} from "@/components/ui/skeleton"

/** One list row: the 34px tile, then the name over its description. */
const Row = ({width}: {width: string}) => (
    <div className="flex items-center gap-3.5 px-3.5 py-2">
        <Skeleton className="size-[34px] shrink-0 rounded-[10px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3" style={{width}} />
        </div>
    </div>
)

/**
 * Home's placeholder, drawn from `HomeFocus`'s own geometry: the greeting block, the composer,
 * the tab row, then five rows in the list. Every measurement is the one the real page
 * uses — the 620px column, the 26px gaps, the 114px composer, the 34px tiles — so content replaces
 * this without moving anything.
 */
export const HomeSkeleton = ({className}: {className?: string}) => (
    <div className={`flex w-full flex-1 flex-col overflow-hidden ${className ?? ""}`}>
        <div className="mx-auto flex w-full max-w-[620px] flex-col gap-[26px]">
            <div className="flex flex-col gap-1.5 px-1.5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-[30px] w-3/4 max-w-[360px]" />
            </div>

            {/* No dock: it names the bound agent, which is exactly what is not known yet. A bar
                standing in for it would promise a second row that may not arrive. */}
            <Skeleton className="h-[114px] w-full rounded-lg" />

            <div className="-mx-2 flex flex-col gap-2">
                <div className="mb-1 mx-2 flex items-center gap-5 border-0 border-b border-solid border-b-[var(--ag-colorSplit)] px-1.5 pb-[7px]">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <span className="flex-1" />
                    <Skeleton className="h-7 w-24 rounded-control-sm" />
                </div>
                <div className="flex flex-col gap-0.5">
                    {["70%", "48%", "62%", "55%", "40%"].map((width) => (
                        <Row key={width} width={width} />
                    ))}
                </div>
            </div>
        </div>
    </div>
)
