import {SkeletonBlock} from "@agenta/ui/ui"

/** The evaluator table while metrics load: its header and three rows of metric cells. */
export const EvaluatorTableSkeleton = ({label}: {label: string}) => (
    <div
        role="status"
        aria-label={label}
        className="box-border overflow-hidden rounded-lg border border-solid border-border"
    >
        <div className="flex gap-4 bg-muted px-3 py-2">
            <SkeletonBlock className="h-4 w-24" />
        </div>
        {[0, 1, 2].map((row) => (
            <div
                key={row}
                className="grid grid-cols-1 gap-x-4 gap-y-2 border-0 border-t border-solid border-border-muted px-3 py-2.5 sm:grid-cols-[240px_minmax(0,1fr)]"
            >
                <div className="flex flex-col gap-1">
                    <SkeletonBlock className="h-4 w-36" />
                    <SkeletonBlock className="h-3 w-16" />
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(max(200px,calc((100%_-_3rem)/3)),1fr))] gap-x-6 gap-y-3">
                    {[0, 1, 2].map((cell) => (
                        <div key={cell} className="flex flex-col gap-1.5">
                            <SkeletonBlock className="h-3 w-2/3" />
                            <SkeletonBlock className="h-1.5 w-full" />
                        </div>
                    ))}
                </div>
            </div>
        ))}
    </div>
)
