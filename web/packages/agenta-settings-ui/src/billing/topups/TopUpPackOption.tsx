import {RadioGroupItem} from "@agenta/ui/ui"

import type {TopUpPack} from "./api"
import {formatCreditCount, formatPackPrice} from "./topUpRules"

/** One pack in the picker: its credits and its price, the whole row selectable. */
export const TopUpPackOption = ({pack, disabled}: {pack: TopUpPack; disabled?: boolean}) => {
    const id = `topup-pack-${pack.code}`
    return (
        <label
            htmlFor={id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-solid border-colorBorderSecondary px-3 py-2.5 has-[[data-state=checked]]:border-colorPrimary has-[:disabled]:cursor-not-allowed"
        >
            <RadioGroupItem id={id} value={pack.code} disabled={disabled} />
            <span className="flex-1 text-sm text-colorText tabular-nums">
                {formatCreditCount(pack.credits)} credits
            </span>
            <span className="text-sm font-medium text-colorText tabular-nums">
                {formatPackPrice(pack.priceCents, pack.currency)}
            </span>
        </label>
    )
}

export default TopUpPackOption
