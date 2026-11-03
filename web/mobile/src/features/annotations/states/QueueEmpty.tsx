import {Button, EmptyState} from "@agenta/ui/ui"
import {Tray} from "@phosphor-icons/react"
import Link from "next/link"

/** The queue has no items yet. Trace queues point to observability, where traces are added. */
export const QueueEmpty = ({
    isTraces,
    observabilityHref,
}: {
    isTraces: boolean
    observabilityHref: string
}) => (
    <EmptyState
        className="py-14"
        image={<Tray aria-hidden size={28} />}
        title="There's nothing to see here"
        description={
            <>
                Currently there are no runs &amp; annotations in this queue,
                <br />
                {isTraces ? "please add runs from traces." : "please add items from test sets."}
            </>
        }
    >
        {isTraces ? (
            <Button size="sm" asChild>
                <Link href={observabilityHref} prefetch={false}>
                    Go to observability
                </Link>
            </Button>
        ) : null}
    </EmptyState>
)
