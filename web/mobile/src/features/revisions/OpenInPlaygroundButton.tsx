import {Button} from "@agenta/ui/ui"
import {Play} from "@phosphor-icons/react"
import Link from "next/link"

/** The revision drawer's link to the playground. The caller shows it only while the view is on. */
export const OpenInPlaygroundButton = ({href}: {href: string}) => (
    <Button asChild variant="outline" size="sm">
        <Link href={href} prefetch={false}>
            <Play aria-hidden size={14} />
            Open in playground
        </Link>
    </Button>
)
