import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
import {ValueCell} from "@agenta/ui/cell-renderers"

import type {ScenarioEvaluatorResult} from "./ScenarioFocusResultsTab"

/**
 * The line under the drawer's "Passed X of Y": the human values of the test case, which never
 * count in it ("2 human annotations · Reviewer feedback good True · Tone review tone friendly").
 * Not shown while no human evaluator has a value.
 */
export const ScenarioFocusHumanLine = ({human}: {human: readonly ScenarioEvaluatorResult[]}) => {
    const t = useT(annotateCatalog)
    const filled = human.filter((result) => result.summary.short.length > 0)
    if (filled.length === 0) return null
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-meta">
            <span className="text-muted-foreground">
                {t("evaluations.scenarioFocusAnnotate.humanAnnotationCount", {
                    count: filled.length,
                })}
            </span>
            {filled.map((result) => (
                <span key={result.id} className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-label">{result.name}</span>
                    {result.summary.short.map((metric) => (
                        <span key={metric.name} className="flex items-center gap-1">
                            <span className="text-muted-foreground">{metric.name}</span>
                            <ValueCell
                                value={metric.value}
                                metricKind={metric.kind}
                                binaryWords="trueFalse"
                                // A badge for True / False and labels; a score as a plain number.
                                density={metric.kind === "numeric" ? "compact" : "comfortable"}
                            />
                        </span>
                    ))}
                </span>
            ))}
        </div>
    )
}
