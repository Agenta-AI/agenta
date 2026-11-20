/** The Name and Value fields of an inline "create a secret", for a text secret. */
import type {Ref} from "react"

import {useT} from "@agenta/i18n"
import secretFormCatalog from "@agenta/i18n/catalogs/entityUi.secretForm"
import {AutosizeTextarea, Input} from "@agenta/ui/ui"

import type {SecretFormController} from "./SecretForm"

const NAME_FIELD_ID = "agent-secret-attach-name"
const VALUE_FIELD_ID = "agent-secret-attach-value"

/** The canvas form label (F04 f7): 12 px, weight 500, secondary. */
const LABEL_CLASS = "text-[12px] font-medium leading-4 text-colorTextSecondary"
/** A 34 px field, 13 px from md up (a phone keeps 16 px so iOS does not zoom), radius 6. */
const FIELD_CLASS = "h-[34px] rounded-[6px] py-0 leading-6 md:text-[13px]"

export function SecretCreateFields({
    controller,
    focusValue = false,
    hint,
    onNameChange,
    nameRef,
    valueRef,
}: {
    controller: SecretFormController
    /** A seeded name means the value is the only thing left to type. */
    focusValue?: boolean
    /** The line under the value, or nothing. */
    hint?: string
    onNameChange?: (name: string) => void
    nameRef?: Ref<HTMLInputElement>
    valueRef?: Ref<HTMLTextAreaElement>
}) {
    const t = useT(secretFormCatalog)
    return (
        <>
            <div className="flex flex-col gap-1">
                <label htmlFor={NAME_FIELD_ID} className={LABEL_CLASS}>
                    {t("entityUi.secretForm.name")}
                </label>
                <Input
                    id={NAME_FIELD_ID}
                    ref={nameRef}
                    autoFocus={!focusValue}
                    className={`font-mono ${FIELD_CLASS}`}
                    placeholder={t("entityUi.secretForm.envPlaceholder")}
                    value={controller.name}
                    onChange={(event) => {
                        controller.onChangeName(event.target.value)
                        onNameChange?.(event.target.value)
                    }}
                />
            </div>
            <div className="flex flex-col gap-1 ph-no-capture">
                <label htmlFor={VALUE_FIELD_ID} className={LABEL_CLASS}>
                    {t("entityUi.secretForm.value")}
                </label>
                {/* One line like an input, as drawn; it grows for a value with several lines. */}
                <AutosizeTextarea
                    id={VALUE_FIELD_ID}
                    ref={valueRef}
                    autoSize={{minRows: 1, maxRows: 6}}
                    className="rounded-[6px] py-[6px] leading-5 md:text-[13px]"
                    placeholder={t("entityUi.secretForm.pasteSecret")}
                    autoFocus={focusValue}
                    value={controller.textValue}
                    onChange={(event) => controller.setTextValue(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                />
                {hint ? (
                    <span className="text-[12px] leading-4 text-colorTextTertiary">{hint}</span>
                ) : null}
            </div>
        </>
    )
}
