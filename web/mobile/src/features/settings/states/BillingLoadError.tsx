import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button} from "@agenta/ui/ui"

/** One part of Plan & billing that failed to load, with its retry. */
export const BillingLoadError = ({message, onRetry}: {message: string; onRetry: () => void}) => {
    const t = useT(commonCatalog)
    return (
        <div className="border-border text-muted-foreground flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-[13px]">
            {message}
            <Button size="sm" variant="outline" onClick={onRetry}>
                {t("common.retry")}
            </Button>
        </div>
    )
}
