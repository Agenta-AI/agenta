import {memo} from "react"

import {Skeleton} from "@agenta/primitive-ui/components/skeleton"

const PromptConfigCardSkeleton = () => (
    <div className="w-full">
        <div className="w-full flex items-center justify-between px-4 py-3 bg-gray-50">
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-6 w-14" />
        </div>
        <div className="w-full px-4 py-3 flex flex-col gap-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-40" />
        </div>
    </div>
)

export default memo(PromptConfigCardSkeleton)
