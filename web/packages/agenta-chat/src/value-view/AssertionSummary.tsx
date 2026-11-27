import type {AssertionSummaryValue} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {formatShapeNumber} from "@agenta/shared/utils"
import {cn} from "@agenta/ui/ui"

const Tile = ({label, value, failed = false}: {label: string; value: string; failed?: boolean}) => (
    <div className="flex min-w-0 flex-col">
        <span className="truncate text-meta text-muted-foreground">{label}</span>
        <span
            className={cn(
                "whitespace-nowrap text-metric tabular-nums",
                failed && "text-destructive",
            )}
        >
            {value}
        </span>
    </div>
)

/**
 * The drawer header's result tiles: "Passed X of Y" over the binary metrics, in `destructive`
 * when one is false; with no binary metric, the main numbers by name and never "Passed". Each
 * tile is one grid item of the header.
 */
export const AssertionSummary = ({summary}: {summary: AssertionSummaryValue}) => {
    const t = useT(valueViewCatalog)
    if (summary.kind === "assertions") {
        return (
            <Tile
                label={t("chat.valueView.passedLabel")}
                value={t("chat.valueView.assertionsValue", {
                    passed: summary.passed,
                    total: summary.total,
                })}
                failed={summary.passed < summary.total}
            />
        )
    }
    return summary.items.map((item) => (
        <Tile key={item.name} label={item.name} value={formatShapeNumber(item.value)} />
    ))
}
