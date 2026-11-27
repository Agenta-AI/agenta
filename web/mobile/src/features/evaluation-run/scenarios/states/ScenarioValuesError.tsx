import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {Button} from "@agenta/ui/ui"

/**
 * The values of one scenario did not load: the row keeps its other cells and can try again. One
 * line, so it fits a table row.
 */
export const ScenarioValuesError = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(scenariosCatalog, commonCatalog)
    const text = t("evaluations.scenarios.valuesError")
    return (
        // The title keeps the reason readable when a narrow column cuts the line.
        <div role="alert" title={text} className="flex min-w-0 items-center gap-1 text-meta">
            <span className="truncate text-muted-foreground">{text}</span>
            <Button
                variant="link"
                size="xs"
                onClick={(event) => {
                    event.stopPropagation()
                    onRetry()
                }}
            >
                {t("common.tryAgain")}
            </Button>
        </div>
    )
}
