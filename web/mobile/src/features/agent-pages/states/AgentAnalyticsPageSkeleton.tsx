import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {useIsPhone} from "@agenta/ui/phone"
import {SkeletonBlock} from "@agenta/ui/ui"

import {ScreenScaffold} from "@/components/ScreenScaffold"

import {SESSIONS_PAGE_FRAME} from "../../sessions/pageFrame"
import {AGENT_ANALYTICS_PAGE_COLUMN} from "../AgentListPageHeader"

/** One analytics card while it loads: the title, the value and the chart at their real sizes. */
const CardSkeleton = () => (
    <div className="flex min-w-0 flex-col rounded-xl bg-muted px-5 pb-4 pt-4">
        <SkeletonBlock active className="h-5 w-28" />
        <div className="mt-1 flex min-h-7 items-baseline">
            <SkeletonBlock active className="h-6 w-24" />
        </div>
        <SkeletonBlock active className="mt-3 h-36 w-full" />
    </div>
)

/** The agent's Analytics page while its code loads: the toolbar and the cards, as it draws them. */
export const AgentAnalyticsPageSkeleton = () => {
    const t = useT(commonCatalog)
    const phone = useIsPhone()
    return (
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
                className={
                    phone
                        ? `min-w-0 px-4 pb-12 pt-3 ${SESSIONS_PAGE_FRAME}`
                        : AGENT_ANALYTICS_PAGE_COLUMN
                }
                aria-busy="true"
                aria-label={t("common.loading")}
            >
                <div className="flex flex-col gap-4 pb-10">
                    <div className="flex items-center gap-2">
                        <SkeletonBlock active className="h-8 w-[230px] rounded-md max-md:h-11" />
                        <SkeletonBlock active className="h-8 w-24 rounded-md max-md:h-11" />
                    </div>
                    <CardSkeleton />
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
                        <CardSkeleton />
                        <CardSkeleton />
                    </div>
                    <CardSkeleton />
                </div>
            </div>
        </ScreenScaffold>
    )
}
