import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/observability.annotate"
import {Button} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"

/** No own annotation and no picked evaluator yet: the way to pick one. */
export const TraceAnnotateEmpty = ({onAddEvaluator}: {onAddEvaluator: () => void}) => {
    const t = useT(annotateCatalog)
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <div className="flex flex-col gap-1">
                <p className="m-0 text-sm font-medium text-foreground">
                    {t("observability.annotate.noAnnotations")}
                </p>
                <p className="m-0 text-sm text-muted-foreground">
                    {t("observability.annotate.noAnnotationsHint")}
                </p>
            </div>
            <Button variant="outline" size="sm" onClick={onAddEvaluator}>
                <PlusIcon size={14} />
                {t("observability.annotate.addEvaluator")}
            </Button>
        </div>
    )
}
