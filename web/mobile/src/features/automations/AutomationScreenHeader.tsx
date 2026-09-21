import {AutomationBackLink} from "@agenta/automation-ui"

import {NavDrawer} from "../nav/NavDrawer"

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
    onBack,
    backLabel,
    className,
}: {
    workspaceId: string
    projectId: string
    title: string
    backHref?: string
    /** In-page return (the run history back to the config); takes precedence over `backHref`. */
    onBack?: () => void
    backLabel?: string
    /** The frame around it, where the screen's own column differs from the form's. */
    className?: string
}) => (
    <div
        className={
            className ??
            "mx-auto w-full max-w-[760px] shrink-0 px-8 pb-4 pt-3 lg:pb-2.5 lg:pt-[30px]"
        }
    >
        {/* -ml-1.5: the glyph sits 6px inside its button, and the column edge is the glyph's. */}
        <div className="-ml-1.5 flex min-w-0 items-center gap-2 lg:hidden">
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
            <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground md:text-[20px] md:leading-[1.4]">
                {title}
            </h1>
        </div>
        <div className="mt-4 flex lg:mt-0">
            <AutomationBackLink href={backHref} onBack={onBack} label={backLabel} />
        </div>
    </div>
)
