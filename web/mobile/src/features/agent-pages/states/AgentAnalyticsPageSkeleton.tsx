import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {useIsPhone} from "@agenta/ui/phone"
import {SkeletonBlock} from "@agenta/ui/ui"

import {ScreenScaffold} from "@/components/ScreenScaffold"

import {PageHeaderSkeleton} from "../../sessions/states/PageHeaderSkeleton"
import {agentAnalyticsColumnClass} from "../analyticsColumn"

import {AnalyticsCardSkeleton} from "./AnalyticsCardSkeleton"

/** The agent's Analytics page while its code loads: the toolbar and the cards, as it draws them. */
export const AgentAnalyticsPageSkeleton = () => {
    const t = useT(commonCatalog)
    return (
        <ScreenScaffold header={<PageHeaderSkeleton />}>
            <div
                className={agentAnalyticsColumnClass(useIsPhone())}
                aria-busy="true"
                aria-label={t("common.loading")}
            >
                <div className="flex flex-col gap-4 pb-10">
                    <div className="flex items-center gap-2">
                        <SkeletonBlock active className="h-8 w-[230px] rounded-md max-md:h-11" />
                        <SkeletonBlock active className="h-8 w-24 rounded-md max-md:h-11" />
                    </div>
                    <AnalyticsCardSkeleton />
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
                        <AnalyticsCardSkeleton />
                        <AnalyticsCardSkeleton />
                    </div>
                    <AnalyticsCardSkeleton />
                </div>
            </div>
        </ScreenScaffold>
    )
}
