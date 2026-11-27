import {useT} from "@agenta/i18n"
import chatMobileConfigCatalog from "@agenta/i18n/catalogs/chat.mobileConfig"
import {
    AgentSectionCardsSkeleton,
    AgentSectionRowsSkeleton,
} from "@agenta/ui/components/presentational"
import {useIsPhone} from "@agenta/ui/phone"

/** The Agent sections while the revision loads: the pane's cards, or the phone's rows. */
export const AgentConfigSectionsSkeleton = () => {
    const t = useT(chatMobileConfigCatalog)
    return (
        <div
            role="status"
            aria-busy
            aria-label={t("chat.mobileConfig.loadingConfiguration")}
            className="px-4"
        >
            {useIsPhone() ? <AgentSectionRowsSkeleton /> : <AgentSectionCardsSkeleton />}
        </div>
    )
}
