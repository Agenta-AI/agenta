import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

/** The run has evaluator rows, but the toolbar's search and filter hid all of them. */
export const EvaluatorsNoMatch = () => {
    const t = useT(runOverviewCatalog)
    return (
        <Empty className="py-10">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <MagnifyingGlassIcon />
                </EmptyMedia>
                <EmptyTitle>{t("evaluations.runOverview.noMatchingEvaluators")}</EmptyTitle>
            </EmptyHeader>
        </Empty>
    )
}
