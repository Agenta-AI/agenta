import type {ReactNode} from "react"

import {PageBackControl, type PageBack} from "./PageBackControl"
import {PAGE_GUTTERS, pageColumn, type PageWidth} from "./pageFrame"

export type {PageBack}

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
            <PageBackControl back={back} size="bar" />
            <span className="flex-1" />
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
    </div>
)
