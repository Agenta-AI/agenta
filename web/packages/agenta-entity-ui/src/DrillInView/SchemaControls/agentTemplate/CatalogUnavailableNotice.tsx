/**
 * CatalogUnavailableNotice — "the schema asked for the harness catalog and we couldn't fetch it".
 *
 * Replaces antd `Alert action={<Button>Retry</Button>}`. The `@agenta/ui` Alert deliberately does
 * not implement `action`, so the Retry button is composed
 * into the description row instead of sitting in antd's trailing action slot — a declared
 * divergence (the button lands one line lower, right-aligned).
 */
import {useT} from "@agenta/i18n"
import providerCredentialsCatalog from "@agenta/i18n/catalogs/entityUi.providerCredentials"
import {Alert, Button} from "@agenta/ui/ui"

export function CatalogUnavailableNotice({onRetry}: {onRetry: () => void}) {
    const t = useT(providerCredentialsCatalog)
    return (
        <Alert
            type="warning"
            showIcon
            message={t("entityUi.providerCredentials.catalogUnavailable")}
            description={
                <div className="flex items-start justify-between gap-4">
                    <span>{t("entityUi.providerCredentials.catalogUnavailableDetail")}</span>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
                        {t("entityUi.providerCredentials.retry")}
                    </Button>
                </div>
            }
        />
    )
}

export default CatalogUnavailableNotice
