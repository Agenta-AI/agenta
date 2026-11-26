import {useT} from "@agenta/i18n"
import marketplaceCatalog from "@agenta/i18n/catalogs/marketplace.page"
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {LayoutGrid} from "lucide-react"

/** The catalog loaded with no templates at all; nothing to clear. */
export const TemplatesEmpty = () => {
    const t = useT(marketplaceCatalog)
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <LayoutGrid />
                </EmptyMedia>
                <EmptyTitle>{t("marketplace.page.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("marketplace.page.emptyBody")}</EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
