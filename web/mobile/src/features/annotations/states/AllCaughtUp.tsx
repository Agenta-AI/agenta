import {annotationSessionController} from "@agenta/annotation"
import {Button, EmptyState, LoadingButton} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"

/**
 * Every item of the queue is completed. Add to Testset exports them all; trace queues also point
 * back to observability for more traces.
 */
export const AllCaughtUp = ({observabilityHref}: {observabilityHref: string}) => {
    const isTraces = useAtomValue(annotationSessionController.selectors.queueKind()) === "traces"
    const isExporting = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetExporting(),
    )
    const openAddToTestset = useSetAtom(annotationSessionController.actions.openAddToTestsetModal)

    return (
        <EmptyState
            className="flex-1 py-14"
            image={<Check aria-hidden size={28} />}
            title="You're all caught up"
            description={
                <>
                    All runs in this queue have been annotated.
                    <br />
                    {isTraces ? "Add more from Tracing." : "Add more from Test Sets."}
                </>
            }
        >
            <div className="flex flex-wrap items-center justify-center gap-2">
                <LoadingButton
                    size="sm"
                    variant="outline"
                    loading={isExporting}
                    onClick={() => openAddToTestset({scope: "complete"})}
                >
                    <Plus aria-hidden size={14} />
                    Add to Testset
                </LoadingButton>
                {isTraces ? (
                    <Button size="sm" variant="outline" asChild>
                        <Link href={observabilityHref} prefetch={false}>
                            Go to observability
                        </Link>
                    </Button>
                ) : null}
            </div>
        </EmptyState>
    )
}
