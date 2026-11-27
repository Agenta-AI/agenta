import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {EmptyState} from "@agenta/ui/composed"
import {Button} from "@agenta/ui/ui"
import {Tray} from "@phosphor-icons/react"
import Link from "next/link"

/** The queue has no items yet. Trace queues point to observability, where traces are added. */
export const QueueEmpty = ({
    isTraces,
    observabilityHref,
}: {
    isTraces: boolean
    observabilityHref: string
}) => {
    const t = useT(queueScreensCatalog)
    return (
        <EmptyState
            className="py-14"
            image={<Tray aria-hidden size={28} />}
            title={t("annotation.queueScreens.emptyTitle")}
            description={
                isTraces
                    ? "Add traces to this queue from Observability."
                    : "Add test cases to this queue from a test set."
            }
        >
            {isTraces ? (
                <Button size="sm" asChild>
                    <Link href={observabilityHref} prefetch={false}>
                        Go to Observability
                    </Link>
                </Button>
            ) : null}
        </EmptyState>
    )
}
