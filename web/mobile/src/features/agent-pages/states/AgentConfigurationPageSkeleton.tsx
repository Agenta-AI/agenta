import {SkeletonBlock} from "@agenta/ui/ui"

import {AgentConfigSectionsSkeleton} from "./AgentConfigSectionsSkeleton"
import {AgentPageSkeleton} from "./AgentPageSkeleton"

/** The Configuration page while its code loads: the segmented switch, then the Agent sections. */
export const AgentConfigurationPageSkeleton = () => (
    <AgentPageSkeleton
        width="md"
        toolbar={
            <div className="mb-3 flex items-center">
                <SkeletonBlock active className="h-control w-64" />
            </div>
        }
    >
        <div className="-mx-4">
            <AgentConfigSectionsSkeleton />
        </div>
    </AgentPageSkeleton>
)
