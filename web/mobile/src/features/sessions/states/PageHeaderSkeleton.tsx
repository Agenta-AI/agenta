import {SkeletonBlock} from "@agenta/ui/ui"

import {PAGE_TITLE_ROW} from "../../page-layout/pageFrame"
import {SESSIONS_PAGE_FRAME} from "../pageFrame"

/** The page header of the sessions and agent pages while the page loads: icon and title. */
export const PageHeaderSkeleton = ({
    frame = `box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${SESSIONS_PAGE_FRAME}`,
}: {
    /** The header box classes; the list skeleton passes its own. */
    frame?: string
}) => (
    <div className={frame} aria-hidden>
        <div className={PAGE_TITLE_ROW}>
            <SkeletonBlock active className="size-7 shrink-0 rounded-md" />
            <SkeletonBlock active className="h-6 w-32" />
        </div>
    </div>
)
