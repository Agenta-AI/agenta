import {ArrowLeft} from "@phosphor-icons/react"
import Link from "next/link"

import {ICON_LINK} from "./lib/interactive"

const CLASS = `text-muted-foreground -ml-1.5 inline-flex min-w-0 items-center gap-[5px] rounded-md py-[3px] pr-2 pl-1.5 text-xs no-underline`

/**
 * Back up one level.
 *
 * The only back affordance in this app: every other screen is a top-level nav destination
 * reachable from the drawer, and these are drill-downs into a row.
 *
 * The label names the DESTINATION, not the link — from a run history that is the automation you
 * came from, and a second "Automations" there would skip a level the reader can see they are on.
 *
 * `onBack` instead of `href` where the destination is another VIEW of the same screen (the run
 * history returning to the config), so going back does not touch the URL.
 */
export const AutomationBackLink = ({
    href,
    onBack,
    label = "Automations",
}: {
    href?: string
    /** In-page return. Takes precedence over `href`. */
    onBack?: () => void
    label?: string
}) =>
    onBack ? (
        <button
            type="button"
            onClick={onBack}
            className={`${CLASS} cursor-pointer border-0 bg-transparent ${ICON_LINK}`}
        >
            <ArrowLeft aria-hidden size={13} className="shrink-0" />
            <span className="truncate">{label}</span>
        </button>
    ) : (
        <Link href={href ?? ""} className={`${CLASS} ${ICON_LINK}`}>
            <ArrowLeft aria-hidden size={13} className="shrink-0" />
            <span className="truncate">{label}</span>
        </Link>
    )
