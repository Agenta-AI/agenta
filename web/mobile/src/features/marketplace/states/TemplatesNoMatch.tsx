import {useT} from "@agenta/i18n"
import marketplaceCatalog from "@agenta/i18n/catalogs/marketplace.page"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {Filter, Search} from "lucide-react"

/** The catalog has templates, but none match the search or the filters. */
export const TemplatesNoMatch = ({term, onClear}: {term?: string; onClear: () => void}) => {
    const t = useT(marketplaceCatalog)
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
                <EmptyTitle>
                    {term
                        ? t("marketplace.page.noMatchTerm", {term})
                        : t("marketplace.page.noMatchFilters")}
                </EmptyTitle>
                <EmptyDescription>{t("marketplace.page.noMatchBody")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button size="sm" variant="outline" onClick={onClear}>
                    {t("marketplace.page.clearFilters")}
                </Button>
            </EmptyContent>
        </Empty>
    )
}
