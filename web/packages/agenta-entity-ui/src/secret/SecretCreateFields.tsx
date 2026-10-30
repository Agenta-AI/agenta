/** The Name and Value fields of an inline "create a secret", for a text secret. */
import type {Ref} from "react"

import {Input, Textarea} from "@agenta/ui/ui"

import type {SecretFormController} from "./SecretForm"

const NAME_FIELD_ID = "agent-secret-attach-name"
const VALUE_FIELD_ID = "agent-secret-attach-value"

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
    return (
        <>
            <div className="flex flex-col gap-1">
                <label htmlFor={NAME_FIELD_ID} className="font-medium text-colorText">
                    Name
                </label>
                <Input
                    id={NAME_FIELD_ID}
                    ref={nameRef}
                    autoFocus={!focusValue}
                    placeholder="For example, GITHUB_TOKEN"
                    value={controller.name}
                    onChange={(event) => {
                        controller.onChangeName(event.target.value)
                        onNameChange?.(event.target.value)
                    }}
                />
            </div>
            <div className="flex flex-col gap-1 ph-no-capture">
                <label htmlFor={VALUE_FIELD_ID} className="font-medium text-colorText">
                    Value
                </label>
                <Textarea
                    id={VALUE_FIELD_ID}
                    ref={valueRef}
                    rows={3}
                    className="font-mono"
                    autoFocus={focusValue}
                    value={controller.textValue}
                    onChange={(event) => controller.setTextValue(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                />
                {hint ? <span className="text-xs text-colorTextSecondary">{hint}</span> : null}
            </div>
        </>
    )
}
