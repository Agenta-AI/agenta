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
        className={`text-muted-foreground -ml-1.5 inline-flex items-center gap-[5px] rounded-md py-[3px] pr-2 pl-1.5 text-xs no-underline ${ICON_LINK}`}
    >
        <ArrowLeft aria-hidden size={13} />
        Automations
    </Link>
)
