import {useCallback} from "react"

import {TextField} from "@agenta/ui/drill-in"

import {FieldFold} from "./FieldFold"

/**
 * A text of several lines: the drill-in text editor (it grows with the text and marks
 * `{{variable}}` tokens), folded after 8 lines. An edit stores a string.
 */
export const TextAreaField = ({
    name,
    text,
    collapseSignal,
    onChange,
}: {
    name: string
    text: string
    collapseSignal: number
    onChange: (next: string) => void
}) => {
    const setValue = useCallback(
        (_path: string[], next: unknown) => onChange(String(next)),
        [onChange],
    )
    return (
        <FieldFold text={text} collapseSignal={collapseSignal}>
            <TextField
                item={{key: name, name, value: text}}
                stringValue={text}
                dataType="string"
                fullPath={[name]}
                fieldKey={`testcase-${name}`}
                setValue={setValue}
                valueMode="native"
            />
        </FieldFold>
    )
}
