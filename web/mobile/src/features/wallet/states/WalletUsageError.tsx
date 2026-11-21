import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import walletCreditsCatalog from "@agenta/i18n/catalogs/wallet.credits"
import {Button} from "@agenta/ui/ui"

export const WalletUsageError = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(commonCatalog, walletCreditsCatalog)
    return (
        <div className="flex flex-col items-start gap-3 p-6">
            <p className="m-0 text-sm">{t("wallet.credits.loadError")}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
                {t("common.retry")}
            </Button>
        </div>
    )
}
