/**
 * DrillInFieldRenderer
 *
 * Renders field content based on data type and mode.
 * Routes to appropriate field renderer component.
 *
 * Field types:
 * - Boolean: Switch toggle
 * - Number: InputNumber
 * - JSON Array: Select + JSON editor
 * - Messages: ChatMessageList
 * - JSON Object: ChatMessageEditor (for single message) or JSON editor
 * - String/Text: Rich text editor with variable tokens
 *
 * Also supports raw mode display for viewing underlying storage format.
 */

import {memo} from "react"

import type {DataType, PathItem} from "../coreTypes"

import {BooleanField} from "./BooleanField"
import {JsonArrayField} from "./JsonArrayField"
import {JsonObjectField} from "./JsonObjectField"
import {MessagesField} from "./MessagesField"
import {NumberField} from "./NumberField"
import {RawModeDisplay} from "./RawModeDisplay"
import {TextField} from "./TextField"

export interface DrillInFieldRendererProps {
    /** The path item containing key, name, and value */
    item: PathItem
    /** Stringified value for display/editing */
    stringValue: string
    /** Detected data type */
    dataType: DataType
    /** Whether raw mode is enabled (read-only storage format view) */
    isRawMode: boolean
    /** Full path to this field */
    fullPath: string[]
    /** Field key for unique identification */
    fieldKey: string
    /** Whether editing is enabled */
    editable: boolean
    /** Function to update value at path */
    setValue: (path: string[], value: unknown) => void
    /** Value storage mode */
    valueMode: "string" | "native"
    /** Callback when a JSON property key is clicked */
    onPropertyClick?: (fullPath: string) => void
    /** Data path for mapping */
    dataPath: string
    /** Function to navigate to a new path */
    setCurrentPath: (path: string[]) => void
    /** Root title for path construction */
    rootTitle: string
}

/**
 * Renders field content based on data type.
 *
 * Supports multiple rendering modes:
 * - Read-only preview (editable=false)
 * - Raw mode (storage format view)
 * - Type-specific editors (boolean, number, messages, etc.)
 * - Rich text editor for strings
 */
export const DrillInFieldRenderer = memo(function DrillInFieldRenderer({
    item,
    stringValue,
    dataType,
    isRawMode,
    fullPath,
    fieldKey,
    editable,
    setValue,
    valueMode,
    onPropertyClick,
    setCurrentPath,
    rootTitle,
}: DrillInFieldRendererProps) {
    // Read-only preview mode
    if (!editable) {
        return (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-[#9d4edd] p-3 bg-gray-50 rounded-md max-h-[120px] overflow-hidden">
                {stringValue}
            </pre>
        )
    }

    // Raw mode - show value in storage format (read-only)
    if (isRawMode) {
        return (
            <RawModeDisplay
                item={item}
                stringValue={stringValue}
                dataType={dataType}
                fullPath={fullPath}
                setValue={setValue}
                valueMode={valueMode}
            />
        )
    }

    // Type-specific rendering
    switch (dataType) {
        case "boolean":
            return (
                <BooleanField
                    item={item}
                    stringValue={stringValue}
                    fullPath={fullPath}
                    setValue={setValue}
                    valueMode={valueMode}
                />
            )

        case "number":
            return (
                <NumberField
                    item={item}
                    stringValue={stringValue}
                    fullPath={fullPath}
                    setValue={setValue}
                    valueMode={valueMode}
                />
            )

        case "json-array":
            return (
                <JsonArrayField
                    item={item}
                    stringValue={stringValue}
                    fullPath={fullPath}
                    setValue={setValue}
                    valueMode={valueMode}
                    setCurrentPath={setCurrentPath}
                />
            )

        case "messages":
            return (
                <MessagesField
                    item={item}
                    stringValue={stringValue}
                    fullPath={fullPath}
                    setValue={setValue}
                    valueMode={valueMode}
                />
            )

        case "json-object":
            return (
                <JsonObjectField
                    item={item}
                    stringValue={stringValue}
                    fullPath={fullPath}
                    fieldKey={fieldKey}
                    editable={editable}
                    setValue={setValue}
                    valueMode={valueMode}
                    onPropertyClick={onPropertyClick}
                    setCurrentPath={setCurrentPath}
                    rootTitle={rootTitle}
                />
            )

        default:
            // String/text mode with rich editor (also handles null values)
            return (
                <TextField
                    item={item}
                    stringValue={stringValue}
                    dataType={dataType}
                    fullPath={fullPath}
                    fieldKey={fieldKey}
                    setValue={setValue}
                    valueMode={valueMode}
                />
            )
    }
})
