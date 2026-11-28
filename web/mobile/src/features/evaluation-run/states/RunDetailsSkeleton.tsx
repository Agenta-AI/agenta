import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {SkeletonBlock} from "@agenta/ui/ui"

import {EvaluatorTableSkeleton} from "./EvaluatorTableSkeleton"

/** The run page while the run loads: the tab bar, the tiles and the evaluator table, in place. */
export const RunDetailsSkeleton = () => {
    const t = useT(runOverviewCatalog)
    return (
        <div role="status" aria-label="Loading evaluation" className="flex flex-col gap-6">
            <div className="flex gap-4">
                {[0, 1, 2].map((index) => (
                    <SkeletonBlock key={index} className="h-6 w-24" />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @min-[960px]/page:grid-cols-6">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                    <SkeletonBlock key={index} className="h-20" />
                ))}
            </div>
            <EvaluatorTableSkeleton label={t("evaluations.runOverview.preparingMetrics")} />
        </div>
    )
}
