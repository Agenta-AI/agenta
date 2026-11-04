import {Button} from "@agenta/ui/ui"
import Link from "next/link"

/** No human evaluator in the project, with a way to the evaluators page when it is enabled. */
export const SelectEvaluatorsEmpty = ({evaluatorsHref}: {evaluatorsHref: string | null}) => (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="m-0 text-sm text-muted-foreground">There are no available evaluators</p>
        {evaluatorsHref ? (
            <Button asChild variant="outline" size="sm">
                <Link href={evaluatorsHref} prefetch={false}>
                    Open evaluators
                </Link>
            </Button>
        ) : null}
    </div>
)
