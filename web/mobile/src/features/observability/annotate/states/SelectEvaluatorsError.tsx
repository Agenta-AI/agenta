import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/observability.annotate"
import {Button} from "@agenta/ui/ui"

/** The evaluator list did not load: say so, and offer to load it again. */
export const SelectEvaluatorsError = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(annotateCatalog)
    return (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="m-0 text-sm text-muted-foreground">
                {t("observability.annotate.evaluatorsLoadFailed")}
            </p>
            <Button variant="outline" size="sm" onClick={onRetry}>
                {t("observability.annotate.tryAgain")}
            </Button>
        </div>
    )
}
