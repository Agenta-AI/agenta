/**
 * Playground Utilities
 *
 * Pure functions for message content manipulation and assistant display extraction.
 * These can be used in both React and non-React contexts.
 */

export {
    computeDisplayValue,
    getTextContent,
    extractBaseProperty,
    extractImageProperties,
    extractFileProperties,
    updateTextContent,
    removeUploadItem,
    buildImageNode,
    buildFileNode,
    buildTextNode,
    addUploadSlot,
    type ComputeDisplayValueArgs,
    type AttachmentNodeType,
    type AddUploadSlotArgs,
    type RemoveUploadItemArgs,
    type MetadataAccessor,
    type ObjectFromMetadataFactory,
} from "./messageContent"

export {
    extractAssistantDisplayValue,
    extractToolCallsView,
    hasAssistantContent,
    resolveEffectiveRevisionId,
    type ToolCallView,
} from "./assistantDisplay"
