import {useT} from "@agenta/i18n"
import accountSwitchCatalog from "@agenta/i18n/catalogs/entityUi.accountSwitch"
import connectFormCatalog from "@agenta/i18n/catalogs/entityUi.connectForm"
import type {OwnerKind} from "@agenta/shared/types"
import {Field} from "@agenta/ui/ui"

import {AccountSwitch} from "./AccountSwitch"

/** Who owns a new connection: the person ("Only me") or the project ("Everyone"). */
export type ConnectionOwner = Exclude<OwnerKind, "organization">

/**
 * The "Who can use it" field of a connect form: "Only me" or "Everyone in {project}", and the
 * full sentence of the selected choice under it. Each connect form passes its own "Only me"
 * sentence, because what the person connects (an account or a sign-in) differs.
 */
export function ConnectOwnerField({
    value,
    owners,
    onChange,
    onlyMeDetail,
    projectName,
}: {
    value: ConnectionOwner
    /** The allowed owners; the field shows only these choices. */
    owners: ConnectionOwner[]
    onChange: (next: ConnectionOwner) => void
    onlyMeDetail: string
    /** The current project's name, for "Everyone in {project}". */
    projectName?: string
}) {
    const t = useT(connectFormCatalog, accountSwitchCatalog)
    // Each choice has one short sentence; the full sentence of the selected one shows under it.
    const choices = [
        {
            value: "user" as const,
            label: t("entityUi.connectForm.onlyMe"),
            note: t("entityUi.accountSwitch.onlyMeShort"),
            detail: onlyMeDetail,
        },
        {
            value: "project" as const,
            label: projectName
                ? t("entityUi.connectForm.everyoneInProject", {project: projectName})
                : t("entityUi.connectForm.everyoneInThisProject"),
            note: t("entityUi.accountSwitch.everyoneShort"),
            detail: t("entityUi.connectForm.everyoneNote"),
        },
    ]
    return (
        <Field label={t("entityUi.connectForm.whoCanUseIt")}>
            <div className="flex flex-col gap-2">
                <AccountSwitch
                    value={value}
                    choices={choices.filter((choice) => owners.includes(choice.value))}
                    onChange={onChange}
                    aria-label={t("entityUi.connectForm.whoCanUseIt")}
                />
                <span className="text-xs text-colorTextTertiary">
                    {choices.find((choice) => choice.value === value)?.detail}
                </span>
            </div>
        </Field>
    )
}
