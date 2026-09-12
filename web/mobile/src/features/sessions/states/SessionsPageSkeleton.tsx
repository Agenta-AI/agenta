import {SkeletonBlock} from "@agenta/ui/ui"

import {ScreenScaffold} from "@/components/ScreenScaffold"
import {cn} from "@/lib/utils"

import {SESSIONS_PAGE_FRAME} from "../pageFrame"

/** Cycled so the column reads as a list of titles rather than a stack of identical pills. */
const TITLE_WIDTHS = ["w-4/5", "w-3/5", "w-11/12"]

/**
 * The sessions page before it knows which project it is showing.
 *
 * The route reads its ids from `router.query`, which is empty on the first render of a hard load
 * — it used to return `null` there, so the page opened as a blank screen and then snapped into a
 * full list. This holds the page's own geometry instead: title, toolbar, column rule. The rows
 * are `ListTable`'s job once the screen mounts.
 *
 * No nav shell: this renders before there is a workspace or project to build one from, and a rail
 * that appears and then re-renders with real entries is worse than one that arrives whole.
 */
export const SessionsPageSkeleton = () => (
    <ScreenScaffold
        header={
            <div
                className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${SESSIONS_PAGE_FRAME}`}
                aria-hidden
            >
                <div className="flex min-w-0 items-center gap-2">
                    <SkeletonBlock active className="size-7 shrink-0 rounded-md" />
                    <SkeletonBlock active className="h-6 w-32" />
                </div>
            </div>
        }
    >
        <div
            className={`min-w-0 px-4 pb-12 pt-3 ${SESSIONS_PAGE_FRAME}`}
            aria-busy="true"
            aria-label="Loading sessions"
        >
            {/* The toolbar's own two controls, at their real sizes, so the search field does not
                jump when it arrives. */}
            <div className="mb-3 flex items-center gap-2">
                <SkeletonBlock active className="h-8 w-full max-w-[340px] rounded-md" />
                <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
            </div>
            {/* The column rule, so the table's header lands on a line that is already there. */}
            <div className="h-9 border-0 border-b border-solid border-border" />
            {Array.from({length: 6}, (_, row) => (
                // The real row's own grid and padding, so the bars sit exactly where the titles
                // will. A bar per cell at the height of the line it stands in — thinner reads as
                // a rule rather than as text waiting to arrive.
                <div
                    key={row}
                    // The wide tracks: this renders before the viewport is measured, and the
                    // Agent bar hides below `sm` as the real table does.
                    className="grid w-full grid-cols-[minmax(160px,2fr)_minmax(120px,1fr)_96px] items-center gap-3 px-2 py-2"
                >
                    <SkeletonBlock active className={cn("h-5 rounded", TITLE_WIDTHS[row % 3])} />
                    <SkeletonBlock active className="hidden h-5 rounded sm:block" />
                    <SkeletonBlock active className="h-5 rounded" />
                </div>
            ))}
        </div>
    </ScreenScaffold>
)
