/**
 * TextField
 *
 * Renders a string/text value with rich text editor supporting variable tokens.
 * Uses EditorProvider/SharedEditor/FieldHeader from @agenta/ui.
 */

import {EditorProvider, FieldHeader, SharedEditor} from "@agenta/ui"

import {getTextModeValue, textModeToStorageValue} from "./fieldUtils"
import type {TextFieldProps} from "./types"

export function TextField({
    item,
    stringValue,
    dataType,
    fullPath,
    fieldKey,
    setValue,
    valueMode,
}: TextFieldProps) {
    const editorId = `drill-field-${fieldKey}`
    // For null values, use empty string; otherwise get text mode value
    const isNull = dataType === "null" || item.value === null
    const textValue = isNull ? "" : getTextModeValue(stringValue)

    const handleChange = (newValue: string) => {
        if (isNull) {
            // Transitioning from null - store as string directly
            setValue(fullPath, newValue)
        } else {
            const storageValue = textModeToStorageValue(newValue, stringValue)
            setValue(fullPath, valueMode === "string" ? storageValue : storageValue)
        }
    }

    return (
        <EditorProvider
            key={`${editorId}-provider`}
            id={editorId}
            initialValue={textValue}
            showToolbar={false}
            enableTokens
        >
            <SharedEditor
                id={editorId}
                initialValue={textValue}
                handleChange={handleChange}
                placeholder={`Enter ${item.name}...`}
                editorType="border"
                className="overflow-hidden"
                disableDebounce
                noProvider
                header={<FieldHeader id={editorId} value={textValue} />}
            />
        </EditorProvider>
    )
}
