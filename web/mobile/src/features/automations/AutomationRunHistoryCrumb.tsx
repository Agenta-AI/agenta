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

const CRUMB_LINK = `min-w-0 cursor-pointer truncate rounded-md border-0 bg-transparent px-1.5 py-[3px] text-[13px] leading-5 text-muted-foreground no-underline hover:bg-accent hover:text-foreground ${PHONE_TOUCH_TARGET_CLASS}`

/**
 * "Automations › <name> › Run history": the run history page names where it sits, as the panel
 * crumb does. "Automations" opens the list; the name returns to the automation.
 */
export const AutomationRunHistoryCrumb = ({
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
