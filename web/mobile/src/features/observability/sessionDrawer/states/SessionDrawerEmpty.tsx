import {useT} from "@agenta/i18n"
import sessionCatalog from "@agenta/i18n/catalogs/observability.sessionDrawer"
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {PulseIcon} from "@phosphor-icons/react"

/** A session id the project has no traces for: an old or wrong link. */
export const SessionDrawerEmpty = () => {
    const t = useT(sessionCatalog)
    return (
        <Empty className="py-16">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <PulseIcon />
                </EmptyMedia>
                <EmptyTitle>{t("observability.sessionDrawer.noTraces")}</EmptyTitle>
            </EmptyHeader>
        </Empty>
    )
}
