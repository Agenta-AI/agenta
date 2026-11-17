import {richText, useT} from "@agenta/i18n"
import clientToolsCatalog from "@agenta/i18n/catalogs/entityUi.clientTools"
import type {ClientToolWidgetProps} from "@agenta/shared/clientTools"

/** The step's sentence for a secret ask; the timeline node beside it wears the key. */
export const SecretRequestWidget = ({meta}: ClientToolWidgetProps) => {
    const t = useT(clientToolsCatalog)
    const input = meta.input as {name?: unknown} | undefined
    const output = meta.output as {status?: string; env_var?: unknown} | undefined
    const envVar = typeof output?.env_var === "string" ? output.env_var : undefined
    const asked = typeof input?.name === "string" ? input.name : undefined
    const name = envVar ?? asked ?? t("entityUi.clientTools.aSecret")
    const strong = {name: (text: string) => <strong className="font-medium">{text}</strong>}
    return (
        <span className="text-sm text-colorText">
            {meta.settled
                ? output?.status === "configured"
                    ? richText(t("entityUi.clientTools.youAddedSecret", {name}), strong)
                    : richText(t("entityUi.clientTools.youSkippedSecret", {name}), strong)
                : richText(t("entityUi.clientTools.waitingToAddSecretBelow", {name}), strong)}
        </span>
    )
}
