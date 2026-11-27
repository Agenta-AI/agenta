import {SkeletonBlock} from "@agenta/ui/ui"

import {AgentPageSkeleton} from "./AgentPageSkeleton"

/** The Channels page while its code loads: the group heading over the grid of channel rows. */
export const AgentChannelsPageSkeleton = () => (
    <AgentPageSkeleton>
        <section className="flex flex-col gap-3">
            <SkeletonBlock active className="h-4.5 w-24 rounded-sm" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-0.5">
                {Array.from({length: 7}, (_, index) => (
                    <div key={index} className="flex h-row-double items-center gap-3">
                        <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <SkeletonBlock active className="h-3.5 w-1/3" />
                            <SkeletonBlock active className="h-3 w-2/3" />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    </AgentPageSkeleton>
)
