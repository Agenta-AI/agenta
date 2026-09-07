import {ArrowLeft} from "@phosphor-icons/react"
import Link from "next/link"

import {ICON_LINK} from "@/lib/interactive"

/**
 * Back to the list.
 *
 * The only back affordance in this app: every other screen is a top-level nav destination
 * reachable from the drawer, and this one is a drill-down into a row.
 */
export const AutomationBackLink = ({href}: {href: string}) => (
    <Link
        href={href}
        className={`text-muted-foreground -ml-1 inline-flex items-center gap-1.5 px-1 py-1 text-sm no-underline ${ICON_LINK}`}
    >
        <ArrowLeft aria-hidden size={16} />
        Automations
    </Link>
)
