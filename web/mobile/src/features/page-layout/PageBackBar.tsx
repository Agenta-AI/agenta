import type {ReactNode} from "react"

import {ArrowLeftIcon} from "@phosphor-icons/react"
import Link from "next/link"

import {PAGE_GUTTERS, pageColumn, type PageWidth} from "./pageFrame"

/** Where Back goes: a link to the parent page, or an in-page return. */
export interface PageBack {
    /** The parent page's name: "Automations", not "Back". */
    label: string
    href?: string
    onBack?: () => void
}

const BACK =
    "-ml-1.5 inline-flex h-control-sm min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-label text-foreground no-underline hover:bg-accent focus-ring"

/**
 * The compact bar of an inside page (COMPACT: "every other page has Back"): Back to the parent on
 * the left, no menu and no title, the page's actions on the right. Hidden on an expanded window.
 */
export const PageBackBar = ({
    back,
    actions,
    column,
    width,
}: {
    back: PageBack
    actions?: ReactNode
    /** The page's own column classes, so Back sits on the heading's edge; the page frame by default. */
    column?: string
    /** With no `column`: the page frame's cap, as `PageLayout`'s `width`. */
    width?: PageWidth
}) => (
    <div className={`shrink-0 bg-muted lg:hidden ${column ? "" : PAGE_GUTTERS}`}>
        <div className={`flex h-header items-center gap-1 ${column ?? pageColumn(width)}`}>
            {back.onBack ? (
                <button type="button" onClick={back.onBack} className={BACK}>
                    <ArrowLeftIcon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{back.label}</span>
                </button>
            ) : (
                <Link href={back.href ?? ""} className={BACK}>
                    <ArrowLeftIcon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{back.label}</span>
                </Link>
            )}
            <span className="flex-1" />
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
    </div>
)
