import {reviewAgreement} from "@agenta/entities/evaluationRun"
import {formatNumber, useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"

import type {RunReview} from "../focus/useRunReviews"

/**
 * "Evaluator agreement": how many saved reviews of the run's automatic evaluators agree, and the
 * evaluator people disagree with most. Not shown while nobody reviewed one.
 */
export const RunAgreementTile = ({reviews}: {reviews: readonly RunReview[]}) => {
    const t = useT(annotateCatalog)
    const {agreed, total, disagreementsByJudge} = reviewAgreement(reviews)
    if (total === 0) return null
    const most = disagreementsByJudge[0]
    return (
        <div
            data-testid="tile-agreement"
            className="box-border flex min-w-0 flex-col gap-0.5 rounded-lg border border-solid border-border px-4 py-3"
        >
            <span className="truncate text-meta text-muted-foreground">
                {t("evaluations.scenarioFocusAnnotate.evaluatorAgreement")}
            </span>
            <span className="text-metric tabular-nums text-foreground">
                {t("evaluations.scenarioFocusAnnotate.agreementValue", {
                    agreed: formatNumber(agreed),
                    total: formatNumber(total),
                })}
            </span>
            {most ? (
                <span className="truncate text-meta text-muted-foreground">
                    {t("evaluations.scenarioFocusAnnotate.disagreementsOn", {
                        count: most.count,
                        judge: most.judge,
                    })}
                </span>
            ) : null}
        </div>
    )
}
