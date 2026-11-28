import type {RunFailures} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {Alert} from "@agenta/ui/ui"
import Link from "next/link"
import {useRouter} from "next/router"

/** Test cases that did not run or that an evaluator failed on, above the tiles. */
export const RunFailuresAlert = ({failures}: {failures: RunFailures}) => {
    const t = useT(runOverviewCatalog)
    const router = useRouter()
    const message = [
        failures.notRun > 0
            ? t("evaluations.runOverview.notRunAlert", {
                  count: failures.notRun,
                  total: failures.total,
              })
            : null,
        failures.evaluatorFailed > 0
            ? t("evaluations.runOverview.evaluatorFailedAlert", {count: failures.evaluatorFailed})
            : null,
    ]
        .filter(Boolean)
        .join(" ")

    return (
        <Alert
            type="error"
            showIcon
            message={message}
            description={t("evaluations.runOverview.countsNote")}
            action={
                <Link
                    href={{pathname: router.pathname, query: {...router.query, view: "scenarios"}}}
                    shallow
                    replace
                    className="text-label text-link no-underline hover:underline"
                >
                    {t("evaluations.runOverview.showTestCases")}
                </Link>
            }
        />
    )
}
