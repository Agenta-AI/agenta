/**
 * FieldRenderers barrel export
 *
 * Field renderer components for displaying different data types in DrillInView.
 * These components use context injection for OSS-specific UI components.
 */

// Components
export {BooleanField} from "./BooleanField"
export {DrillInFieldRenderer} from "./DrillInFieldRenderer"
export {JsonArrayField} from "./JsonArrayField"
export {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
export {JsonObjectField} from "./JsonObjectField"
export {MessagesField} from "./MessagesField"
export {NumberField} from "./NumberField"
export {RawModeDisplay} from "./RawModeDisplay"
export {TextField} from "./TextField"

// Types
export type {
    BaseFieldProps,
    JsonArrayFieldProps,
    JsonObjectFieldProps,
    RawModeDisplayProps,
    TextFieldProps,
} from "./types"

export type {DrillInFieldRendererProps} from "./DrillInFieldRenderer"

// Field utilities
export {
    // Parsing utilities
    getNestedValue,
    getArrayItemValue,
    canExpandValue,
    canExpandAsArray,
    canExpand,
    // Message utilities
    isChatMessageObject,
    isMessagesArray,
    parseMessages,
    // Data type utilities
    detectDataType,
    canShowTextMode,
    getTextModeValue,
    textModeToStorageValue,
    formatForJsonDisplay,
    parseFromJsonDisplay,
    // Constants
    MAX_NESTED_DEPTH,
} from "./fieldUtils"

// NOTE: tryParseAsObject, tryParseAsArray, SimpleChatMessage should be imported
// directly from @agenta/shared
