import {SkeletonBlock} from "@agenta/ui/ui"

/** One method card: the 32 px Mark, then its name over one line. */
const MethodSkeleton = ({name}: {name: string}) => (
    <div className="-mx-3 flex min-h-row-double items-center gap-3 px-3 py-1.5">
        <SkeletonBlock shape="mark" className="size-8 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex h-5 items-center">
                <SkeletonBlock className={`h-3.5 ${name}`} />
            </div>
            <div className="flex h-4.5 items-center">
                <SkeletonBlock className="h-3 w-48" />
            </div>
        </div>
    </div>
)

/** One "What to expect" fact: the 16 px icon, then its title over one line. */
const FactSkeleton = ({last}: {last?: boolean}) => (
    <div
        className={`flex items-start gap-3 py-3 ${last ? "" : "border-0 border-b border-solid border-border-muted"}`}
    >
        <SkeletonBlock className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
            <div className="flex h-5.5 items-center">
                <SkeletonBlock className="h-3.5 w-40" />
            </div>
            <div className="flex h-4.5 items-center">
                <SkeletonBlock className="h-3 w-64 max-w-full" />
            </div>
        </div>
    </div>
)

/** The connect flow while its code loads: Connect with, the method cards, then What to expect. */
export const ChannelConnectSkeleton = () => (
    <div aria-busy className="flex min-h-full flex-1 flex-col gap-6">
        <div className="flex flex-col gap-2">
            <div className="flex h-4.5 items-center">
                <SkeletonBlock className="h-3.5 w-24" />
            </div>
            <div className="flex flex-col gap-2">
                <MethodSkeleton name="w-24" />
                <MethodSkeleton name="w-28" />
            </div>
            <div className="flex h-4 items-center">
                <SkeletonBlock className="h-3 w-72 max-w-full" />
            </div>
        </div>
        <div className="flex flex-col gap-2">
            <div className="flex h-4.5 items-center">
                <SkeletonBlock className="h-3.5 w-28" />
            </div>
            <div className="flex flex-col">
                <FactSkeleton />
                <FactSkeleton />
                <FactSkeleton last />
            </div>
        </div>
    </div>
)
