/** The Name and Value fields of an inline "create a secret", for a text secret. */
import type {Ref} from "react"

import {useT} from "@agenta/i18n"
import secretFormCatalog from "@agenta/i18n/catalogs/entityUi.secretForm"
import {AutosizeTextarea} from "@agenta/ui/composed"
import {Field, Input} from "@agenta/ui/ui"

import type {SecretFormController} from "./SecretForm"

const NAME_FIELD_ID = "agent-secret-attach-name"
const VALUE_FIELD_ID = "agent-secret-attach-value"

export function SecretCreateFields({
    controller,
    focusValue = false,
    valueTooltip,
    onNameChange,
    nameRef,
    valueRef,
}: {
    controller: SecretFormController
    /** A seeded name means the value is the only thing left to type. */
    focusValue?: boolean
    /** The help in the Value label's tooltip, or nothing. */
    valueTooltip?: string
    onNameChange?: (name: string) => void
    nameRef?: Ref<HTMLInputElement>
    valueRef?: Ref<HTMLTextAreaElement>
}) {
    const t = useT(secretFormCatalog)
    return (
        <>
            <Field label={t("entityUi.secretForm.name")}>
                <Input
                    id={NAME_FIELD_ID}
                    ref={nameRef}
                    autoFocus={!focusValue}
                    className="font-mono"
                    placeholder={t("entityUi.secretForm.envPlaceholder")}
                    value={controller.name}
                    onChange={(event) => {
                        controller.onChangeName(event.target.value)
                        onNameChange?.(event.target.value)
                    }}
                />
            </Field>
            <Field
                label={t("entityUi.secretForm.value")}
                tooltip={valueTooltip}
                className="ph-no-capture"
            >
                {/* One line like an input; it grows for a value with several lines. */}
                <AutosizeTextarea
                    id={VALUE_FIELD_ID}
                    ref={valueRef}
                    autoSize={{minRows: 1, maxRows: 6}}
                    placeholder={t("entityUi.secretForm.pasteSecret")}
                    autoFocus={focusValue}
                    value={controller.textValue}
                    onChange={(event) => controller.setTextValue(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                />
            </Field>
        </>
    )
}
