import {useT} from "@agenta/i18n"
import secretFormCatalog from "@agenta/i18n/catalogs/entityUi.secretForm"

import {AccountSwitch} from "../accounts/AccountSwitch"

export interface OwnerOption<Owner extends string> {
    value: Owner
    label: string
    /** The line under the label: what choosing it means. */
    note: string
}

export interface OwnerRadioGroupProps<Owner extends string> {
    value: Owner
    options: OwnerOption<Owner>[]
    onChange: (next: Owner) => void
    /** Names the group for assistive tech; the host draws the visible label. */
    "aria-label"?: string
}

/**
 * The "Who can use it" choice of an add dialog (and Bedrock's "Sign in with"): the shared
 * two-choice switch, each choice with a note. The host draws the field label in its own form's
 * style.
 */
export function OwnerRadioGroup<Owner extends string>({
    value,
    options,
    onChange,
    "aria-label": ariaLabel,
}: OwnerRadioGroupProps<Owner>) {
    const t = useT(secretFormCatalog)
    return (
        <AccountSwitch<Owner>
            aria-label={ariaLabel ?? t("entityUi.secretForm.whoCanUseIt")}
            value={value}
            choices={options}
            onChange={onChange}
        />
    )
}
