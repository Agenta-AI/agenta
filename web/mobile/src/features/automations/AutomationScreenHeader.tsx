import {AutomationBackLink} from "@agenta/automation-ui"

import {NavDrawer} from "../nav/NavDrawer"

import {AutomationRunHistoryCrumb} from "./AutomationRunHistoryCrumb"

/**
 * The header over an automation's form, in the form's own column at every width.
 *
 * Below `lg` the drawer button is visible, so the bar is the list pages' bar — hamburger, then a
 * title — with the back link on its own line under it. From `lg` the drawer is a sidebar, the
 * editable name is the heading, and the header is only the back link.
 */
export const AutomationScreenHeader = ({
    workspaceId,
    projectId,
    title,
    backHref,
    runHistory,
    className,
}: {
    workspaceId: string
    projectId: string
    title: string
    backHref?: string
    /** The run history page: a crumb up to the list and the automation, in place of the back link. */
    runHistory?: {listHref: string; name: string; onAutomation: () => void}
    /** The frame around it, where the screen's own column differs from the form's. */
    className?: string
}) => (
    <div
        className={
            className ??
            "mx-auto w-full max-w-content-md shrink-0 px-8 pb-4 pt-3 max-md:pb-3 lg:pb-2.5 lg:pt-8"
        }
    >
        {/* -ml-1.5: the glyph sits 6px inside its button, and the column edge is the glyph's. */}
        <div className="-ml-1.5 flex min-w-0 items-center gap-2 lg:hidden">
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
            {/* Not an h1: the body below already carries the page's heading (the editable name,
                or "Run history"), and a second h1 gave the page two roots. */}
            <p className="m-0 min-w-0 flex-1 truncate text-heading text-foreground">
                {title}
            </p>
        </div>
        <div className="mt-4 flex min-w-0 lg:mt-0">
            {runHistory ? (
                <AutomationRunHistoryCrumb {...runHistory} />
            ) : (
                <AutomationBackLink href={backHref} />
            )}
        </div>
    </div>
)
