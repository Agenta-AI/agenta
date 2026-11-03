import {Button, EmptyState} from "@agenta/ui/ui"
import Link from "next/link"

/** The queue request settled with no queue: it was deleted, or the link is wrong. */
export const QueueNotFound = ({listHref}: {listHref: string}) => (
    <EmptyState className="py-14" title="Queue not found">
        <Button size="sm" variant="outline" asChild>
            <Link href={listHref} prefetch={false}>
                Back to queues
            </Link>
        </Button>
    </EmptyState>
)
