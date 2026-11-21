import {SkeletonBlock} from "@agenta/ui/ui"

import {SESSIONS_PAGE_FRAME} from "../pageFrame"

/** The page header of the sessions and agent pages while the page loads: icon and title. */
export const PageHeaderSkeleton = () => (
    <div
        className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${SESSIONS_PAGE_FRAME}`}
        aria-hidden
    >
        <div className="flex min-w-0 items-center gap-2">
            <SkeletonBlock active className="size-7 shrink-0 rounded-md" />
            <SkeletonBlock active className="h-6 w-32" />
        </div>
    </div>
)
