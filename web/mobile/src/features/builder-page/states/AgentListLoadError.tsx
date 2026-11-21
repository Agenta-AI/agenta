import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {LoadError} from "@agenta/ui/components/presentational"

/** An agent tab when the agent list could not load: a load error with retry, not "no access". */
export const AgentListLoadError = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(builderPageCatalog)
    return (
        <div className="p-4">
            <LoadError framed title={t("builder.page.agentsFailed")} onRetry={onRetry} />
        </div>
    )
}
