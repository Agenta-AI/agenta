import {SkeletonBlock} from "@agenta/ui/ui"

import {AgentPageSkeleton} from "./AgentPageSkeleton"
import {AnalyticsCardSkeleton} from "./AnalyticsCardSkeleton"

/** The agent's Analytics page while its code loads: the filter row and the cards, as it draws them. */
export const AgentAnalyticsPageSkeleton = () => (
    <AgentPageSkeleton>
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
                <SkeletonBlock active className="h-8 w-56 rounded-md" />
                <SkeletonBlock active className="h-8 w-24 rounded-md" />
            </div>
            <AnalyticsCardSkeleton />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
                <AnalyticsCardSkeleton />
                <AnalyticsCardSkeleton />
            </div>
            <AnalyticsCardSkeleton />
        </div>
    </AgentPageSkeleton>
)
