import Link from "next/link"

/** No evaluator exists in the project. The link shows only while the evaluators view is on. */
export const EvaluatorsEmpty = ({evaluatorsHref}: {evaluatorsHref: string | null}) => (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-border px-4 py-5">
        <p className="m-0 text-sm font-medium text-foreground">No evaluators yet</p>
        <p className="m-0 text-sm text-muted-foreground">
            Evaluators help you measure and analyze your model&apos;s responses.
        </p>
        {evaluatorsHref ? (
            <Link
                href={evaluatorsHref}
                prefetch={false}
                className="mt-2 text-sm font-medium text-foreground underline"
            >
                Open evaluators
            </Link>
        ) : null}
    </div>
)
