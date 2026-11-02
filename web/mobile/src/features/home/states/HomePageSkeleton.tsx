import {SkeletonBlock} from "@agenta/ui/ui"

import {ScreenScaffold} from "@/components/ScreenScaffold"

import {HOME_PAGE_FRAME} from "../pageFrame"

import {HomeSkeleton} from "./HomeSkeleton"

/**
 * The home page before it knows which project it is showing.
 *
 * Two arrivals land here. The `/apps` route reads its ids from `router.query`, which is empty on
 * the first render of a hard load — it used to return `null` there, so the page opened blank and
 * then snapped in. And the context gates (`/m/`, `/w/...`) resolve a project and forward to its
 * home; they used to hold a bare "Loading…" line, so a reload showed a line of text, then the
 * home skeleton, then the page — three frames for one arrival. Holding the home's own geometry
 * from the first frame makes the forward invisible.
 *
 * No nav shell: this renders before there is a workspace or project to build one from, and a rail
 * that appears and then re-renders with real entries is worse than one that arrives whole.
 */
export const HomePageSkeleton = () => (
    <ScreenScaffold
        header={
            // The real header's own box: the drawer button and the project name, at their sizes.
            <div
                className="border-border flex shrink-0 items-center gap-2 border-b px-4 pb-3 pt-2 lg:hidden"
                aria-hidden
            >
                <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
                <SkeletonBlock active className="h-4 w-24" />
            </div>
        }
    >
        <div className="flex flex-1 flex-col" aria-busy="true" aria-label="Loading home">
            <HomeSkeleton className={HOME_PAGE_FRAME} />
        </div>
    </ScreenScaffold>
)
