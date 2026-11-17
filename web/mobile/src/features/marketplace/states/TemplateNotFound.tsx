import {useT} from "@agenta/i18n"
import marketplaceCatalog from "@agenta/i18n/catalogs/marketplace.page"
import {Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"
import Link from "next/link"

/** The catalog loaded without this key, e.g. a link newer than this instance. */
export const TemplateNotFound = ({marketplaceHref}: {marketplaceHref: string}) => {
    const t = useT(marketplaceCatalog)
    return (
        <Empty className="py-16">
            <EmptyHeader>
                <EmptyTitle>{t("marketplace.page.notFoundTitle")}</EmptyTitle>
                <EmptyDescription>{t("marketplace.page.notFoundBody")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button size="sm" variant="outline" asChild>
                    <Link href={marketplaceHref}>{t("marketplace.page.browseMarketplace")}</Link>
                </Button>
            </EmptyContent>
        </Empty>
    )
}
