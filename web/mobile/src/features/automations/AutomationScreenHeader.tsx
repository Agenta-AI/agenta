import {AutomationBackLink} from "@agenta/automation-ui"

import {PageBackBar, type PageBack} from "../page-layout/PageBackBar"

/** The form's own column: 16px gutters on a phone, 32px from `sm`, the page frame's. */
export const AUTOMATION_COLUMN = "mx-auto box-border w-full max-w-content-md px-4 sm:px-8"

/**
 * The top of an automation's page. Below `lg` it is the inside page's bar: Back to the parent,
 * no menu and no title (the editable name below is the heading). From `lg` the sidebar is docked,
 * so the bar goes and the back link sits over the heading.
 */
export const AutomationScreenHeader = ({
    back,
    backHref,
    className,
}: {
    /** The compact bar's Back. */
    back: PageBack
    backHref?: string
    /** The frame around the expanded back link, where the screen's own column differs. */
    className?: string
}) => (
    <>
        <PageBackBar back={back} column={className ?? AUTOMATION_COLUMN} />
        {/* On a compact window only its top padding shows: the 24px every page has under the bar. */}
        <div className={`${className ?? AUTOMATION_COLUMN} shrink-0 pt-6 lg:pb-2.5 lg:pt-8`}>
            <div className="flex min-w-0 max-lg:hidden">
                <AutomationBackLink href={backHref} />
            </div>
        </div>
    </>
)
