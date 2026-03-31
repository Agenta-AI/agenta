/**
 * Types for field renderer components
 */

import type {PathItem, DataType, ValueMode} from "../coreTypes"

/**
 * Base props shared by all field renderer components
 */
export interface BaseFieldProps {
    /** The path item containing key, name, and value */
    item: PathItem
    /** Stringified value for display/editing */
    stringValue: string
    /** Full path to this field */
    fullPath: string[]
    /** Function to update value at path */
    setValue: (path: string[], value: unknown) => void
    /** Value storage mode */
    valueMode: ValueMode
}

/**
 * Props for RawModeDisplay component
 */
export interface RawModeDisplayProps extends BaseFieldProps {
    /** Detected data type */
    dataType: DataType
}

/**
 * Props for JsonArrayField component
 */
export interface JsonArrayFieldProps extends BaseFieldProps {
    /** Function to navigate to a new path */
    setCurrentPath: (path: string[]) => void
}

/**
 * Props for JsonObjectField component
 */
export interface JsonObjectFieldProps extends BaseFieldProps {
    /** Field key for unique identification */
    fieldKey: string
    /** Whether editing is enabled */
    editable: boolean
    /** Callback when a JSON property key is clicked */
    onPropertyClick?: (fullPath: string) => void
    /** Function to navigate to a new path */
    setCurrentPath: (path: string[]) => void
    /** Root title for path construction */
    rootTitle: string
}

/**
 * Props for TextField component
 */
export interface TextFieldProps extends BaseFieldProps {
    /** Detected data type */
    dataType: DataType
    /** Field key for unique identification */
    fieldKey: string
}
