import {useCallback, useState} from "react"

import {FieldFold, needsFold} from "@agenta/chat/value-view"
import {TextField} from "@agenta/ui/drill-in"

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
    // Whether the text folds is decided when the field opens: the fold wraps the editor in
    // another element, and a text that grows past the fold while the user types would remount
    // the editor and lose the focus.
    const [folds] = useState(() => needsFold(text))
    const setValue = useCallback(
        (_path: string[], next: unknown) => onChange(String(next)),
        [onChange],
    )
    return (
        <FieldFold text={text} collapseSignal={collapseSignal} unfolded={!folds}>
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
