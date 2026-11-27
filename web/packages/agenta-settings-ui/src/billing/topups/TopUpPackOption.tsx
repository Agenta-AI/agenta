import {useT} from "@agenta/i18n"
import billingTopupsCatalog from "@agenta/i18n/catalogs/billing.topups"
import {RadioGroupItem} from "@agenta/ui/ui"

import type {TopUpPack} from "./api"
import {formatCreditCount, formatPackPrice} from "./topUpRules"

/** One pack in the picker: its credits and its price, the whole row selectable. */
export const TopUpPackOption = ({pack, disabled}: {pack: TopUpPack; disabled?: boolean}) => {
    const t = useT(billingTopupsCatalog)
    const id = `topup-pack-${pack.code}`
    return (
        <label
            htmlFor={id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-solid border-border-muted px-3 py-2.5 has-[[data-state=checked]]:border-primary has-[:disabled]:cursor-not-allowed"
        >
            <RadioGroupItem id={id} value={pack.code} disabled={disabled} />
            <span className="flex-1 text-body text-foreground tabular-nums">
                {t("billing.topups.packCredits", {credits: formatCreditCount(pack.credits)})}
            </span>
            <span className="text-label text-foreground tabular-nums">
                {formatPackPrice(pack.priceCents, pack.currency)}
            </span>
        </label>
    )
}

export default TopUpPackOption
