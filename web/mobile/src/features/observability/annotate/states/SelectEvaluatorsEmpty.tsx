import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/observability.annotate"
import {Button} from "@agenta/ui/ui"
import Link from "next/link"

/**
 * No human evaluator in the project, with a way to the evaluators page when it is enabled, and
 * with `onCreate` a way to create one here.
 */
export const SelectEvaluatorsEmpty = ({
    evaluatorsHref,
    onCreate,
}: {
    evaluatorsHref: string | null
    onCreate?: () => void
}) => {
    const t = useT(annotateCatalog)
    return (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="m-0 text-sm text-muted-foreground">
                {t("observability.annotate.noEvaluators")}
            </p>
            {onCreate ? (
                <Button size="sm" onClick={onCreate}>
                    {t("observability.annotate.createEvaluator")}
                </Button>
            ) : null}
            {evaluatorsHref ? (
                <Button asChild variant="outline" size="sm">
                    <Link href={evaluatorsHref} prefetch={false}>
                        {t("observability.annotate.openEvaluators")}
                    </Link>
                </Button>
            ) : null}
        </div>
    )
}
