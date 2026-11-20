import {AutomationBackLink} from "@agenta/automation-ui"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    PHONE_TOUCH_TARGET_CLASS,
} from "@agenta/ui/ui"
import Link from "next/link"

import {NavDrawer} from "../nav/NavDrawer"

const CRUMB_LINK = `min-w-0 cursor-pointer truncate rounded-md border-0 bg-transparent px-1.5 py-[3px] text-[13px] leading-5 text-muted-foreground no-underline hover:bg-accent hover:text-foreground ${PHONE_TOUCH_TARGET_CLASS}`

/**
 * "Automations › <name> › Run history": the run history page names where it sits, as the panel
 * crumb does. "Automations" opens the list; the name returns to the automation.
 */
const RunHistoryCrumb = ({
    listHref,
    name,
    onAutomation,
}: {
    listHref: string
    name: string
    onAutomation: () => void
}) => {
    const t = useT(automationsScreensCatalog, automationsEditorCatalog)
    return (
        <Breadcrumb className="-ml-1.5 min-w-0">
            <BreadcrumbList className="flex-nowrap items-center gap-0.5 text-[13px] sm:gap-0.5">
                <BreadcrumbItem className="shrink-0">
                    <BreadcrumbLink asChild>
                        <Link href={listHref} className={CRUMB_LINK}>
                            {t("automations.screens.pageTitle")}
                        </Link>
                    </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="mx-0.5 h-auto text-colorTextTertiary">
                    ›
                </BreadcrumbSeparator>
                <BreadcrumbItem className="min-w-0">
                    <BreadcrumbLink asChild>
                        <button type="button" onClick={onAutomation} className={CRUMB_LINK}>
                            {name}
                        </button>
                    </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="mx-0.5 h-auto text-colorTextTertiary">
                    ›
                </BreadcrumbSeparator>
                <BreadcrumbItem className="shrink-0">
                    <BreadcrumbPage className="px-1.5 py-[3px] text-[13px] font-semibold leading-5 text-foreground">
                        {t("automations.editor.runHistory")}
                    </BreadcrumbPage>
                </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
    )
}

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
            "mx-auto w-full max-w-[760px] shrink-0 px-8 pb-4 pt-3 lg:pb-2.5 lg:pt-[30px]"
        }
    >
        {/* -ml-1.5: the glyph sits 6px inside its button, and the column edge is the glyph's. */}
        <div className="-ml-1.5 flex min-w-0 items-center gap-2 lg:hidden">
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
            {/* Not an h1: the body below already carries the page's heading (the editable name,
                or "Run history"), and a second h1 gave the page two roots. */}
            <p className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground md:text-[20px] md:leading-[1.4]">
                {title}
            </p>
        </div>
        <div className="mt-4 flex min-w-0 lg:mt-0">
            {runHistory ? (
                <RunHistoryCrumb {...runHistory} />
            ) : (
                <AutomationBackLink href={backHref} />
            )}
        </div>
    </div>
)
