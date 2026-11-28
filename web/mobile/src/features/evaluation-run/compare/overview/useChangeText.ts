import {formatSigned, type CompareChange} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"

/**
 * The text of a change: "+11 points", "−0.08", "no change", or "—" when a run has no value.
 * `format` prints the size of a difference in the value's own unit.
 */
export function useChangeText() {
    const t = useT(runOverviewCatalog)
    return (change: CompareChange, format: (value: number) => string) => {
        switch (change.kind) {
            case "missing":
                return "—"
            case "none":
                return t("evaluations.runOverview.noChange")
            case "points":
                return change.points > 0
                    ? t("evaluations.runOverview.pointsUp", {count: change.points})
                    : t("evaluations.runOverview.pointsDown", {count: -change.points})
            case "difference":
                return formatSigned(change.delta, format)
        }
    }
}
