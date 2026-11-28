import {Button, EmptyState} from "@agenta/ui/ui"
import Link from "next/link"

/** The queue request settled with no queue: it was deleted, or the link is wrong. */
export const QueueNotFound = ({listHref, backLabel}: {listHref: string; backLabel: string}) => (
    <EmptyState className="py-14" title="Queue not found">
        <Button size="sm" variant="outline" asChild>
            <Link href={listHref} prefetch={false}>
                {backLabel}
            </Link>
        </Button>
    </EmptyState>
)
