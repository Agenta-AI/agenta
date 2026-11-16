import {useT} from "@agenta/i18n"
import sessionsMobileListCatalog from "@agenta/i18n/catalogs/sessions.mobileList"
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

/** The project has sessions, but the search or filters hid them; offers the way back. */
export const SessionsNoMatch = ({
    term,
    onClear,
}: {
    /** The search that matched nothing. Absent ⇒ the filters are what narrowed it. */
    term?: string
    onClear?: () => void
}) => {
    const t = useT(sessionsMobileListCatalog)
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyMedia variant="icon">{term ? <Search /> : <Filter />}</EmptyMedia>
                <EmptyTitle>
                    {term
                        ? t("sessions.mobileList.nothingMatches", {term})
                        : t("sessions.mobileList.noMatchFilters")}
                </EmptyTitle>
                <EmptyDescription>
                    {term
                        ? t("sessions.mobileList.tryShorter")
                        : t("sessions.mobileList.allHidden")}
                </EmptyDescription>
            </EmptyHeader>
            {onClear ? (
                <EmptyContent>
                    <Button size="sm" variant="outline" onClick={onClear}>
                        {term
                            ? t("sessions.mobileList.clearSearch")
                            : t("sessions.mobileList.resetFilters")}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}
