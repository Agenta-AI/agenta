/**
 * Pure utility functions for playground message content manipulation.
 *
 * These are stateless functions that operate on message content structures.
 * They replace the old useMessageContentHandlers hook which wrapped pure
 * functions in unnecessary useCallback wrappers.
 *
 * For metadata-dependent operations (building attachment nodes from schema),
 * functions accept a `metadataAccessor` parameter to avoid coupling to
 * a specific entity system.
 */

import {asRecord, generateId} from "@agenta/shared/utils"

type AnyObj = Record<string, unknown>

const getNodeType = (part: unknown): string | undefined => {
    const partRec = asRecord(part)
    if (!partRec) return undefined
    const typeRec = asRecord(partRec.type)
    return (typeRec?.value ?? partRec.type) as string | undefined
}

// ============================================================================
// TYPES
// ============================================================================

export interface ComputeDisplayValueArgs {
    propsInitialValue?: string
    value: unknown
    isFunction: boolean
    isTool: boolean
    contentProperty?: {value?: unknown}
}

export type AttachmentNodeType = "image_url" | "file"

export interface AddUploadSlotArgs {
    contentProperty?: {__metadata?: string; value?: unknown}
    max?: number
    attachmentType?: AttachmentNodeType
}

export interface RemoveUploadItemArgs {
    contentProperty?: {value?: unknown}
    propertyId: string
}

/**
 * Accessor for entity metadata. Allows decoupling from a specific entity system.
 * Pass `legacyAppRevisionMolecule.metadata.getLazy` or a custom implementation.
 */
export type MetadataAccessor = (metadataId: string) => AnyObj | undefined

/**
 * Factory for creating objects from metadata. Allows decoupling from a specific entity system.
 * Pass `createObjectFromMetadata` from `@agenta/entities/legacyAppRevision`.
 */
export type ObjectFromMetadataFactory = (metadata: AnyObj) => AnyObj

// ============================================================================
// TEXT EXTRACTION
// ============================================================================

/**
 * Extract display text from message content.
 *
 * Handles string content, array content (with text nodes), and tool messages.
 */
export function computeDisplayValue(args: ComputeDisplayValueArgs): string {
    const {propsInitialValue, value, isFunction, isTool, contentProperty} = args
    if (isFunction) {
        return propsInitialValue || (typeof value === "string" ? value : "")
    } else if (isTool) {
        const x = value
        if (Array.isArray(x)) {
            const textNode = x.filter((part) => part && typeof part === "object" && "text" in part)
            return textNode
                .map((part) => {
                    const partRec = asRecord(part)
                    const textRec = asRecord(partRec?.text)
                    return (textRec?.value as string | undefined) ?? ""
                })
                .join("")
        }
        return typeof x === "string" ? x : ""
    } else {
        const source = contentProperty?.value ?? value
        const sourceRec = asRecord(source)
        const x = sourceRec && "value" in sourceRec ? sourceRec.value : source
        if (Array.isArray(x)) {
            const textNodes = x.filter((part) => {
                const partRec = asRecord(part)
                if (!partRec) return false
                const hasText = "text" in partRec
                const isTextType = getNodeType(part) === "text"
                return hasText && isTextType
            })
            return textNodes
                .map((part) => {
                    const partRec = asRecord(part)
                    const textRec = asRecord(partRec?.text)
                    return (textRec?.value as string | undefined) ?? ""
                })
                .join("")
        }
        return (typeof x === "string" ? x : "") || ""
    }
}

/**
 * Extract text content from an array of content parts.
 * Handles both `{type: {value: "text"}, text: ...}` and `{type: "text", text: ...}` shapes.
 */
export function getTextContent(content: unknown): string {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        const value = content.filter((part) => getNodeType(part) === "text")
        return value.length > 0
            ? (() => {
                  const first = asRecord(value[0])
                  const text = first?.text
                  if (typeof text === "string") return text
                  const textRec = asRecord(text)
                  return (textRec?.value as string | undefined) ?? ""
              })()
            : ""
    }
    return ""
}

// ============================================================================
// MESSAGE PROPERTY EXTRACTION
// ============================================================================

/**
 * Extract the base text property from a message's content.
 * For array content, finds the text node. For simple content, returns the content itself.
 */
export function extractBaseProperty(content: {value?: unknown; __id?: string} | undefined | null) {
    if (!content) return null
    const val = content.value
    if (Array.isArray(val)) {
        const textItem = val.find((item) => getNodeType(item) === "text")
        return asRecord(textItem)?.text || null
    }
    return content
}

/**
 * Extract image URL properties from array content.
 */
export function extractImageProperties(contentValue: unknown): unknown[] {
    if (!Array.isArray(contentValue)) return []
    return contentValue
        .map((value) => {
            const valueRec = asRecord(value)
            if (valueRec) {
                if ("image_url" in valueRec) return asRecord(valueRec.image_url)?.url
                if ("imageUrl" in valueRec) return asRecord(valueRec.imageUrl)?.url
            }
            return undefined
        })
        .filter((node) => node != null)
}

/**
 * Extract file properties from array content.
 */
export function extractFileProperties(contentValue: unknown): {
    fileId?: unknown
    fileData?: unknown
    name?: unknown
    mimeType?: unknown
    format?: unknown
}[] {
    if (!Array.isArray(contentValue)) return []

    const normalizeFileProp = (fileNode: unknown, keyCandidates: string[]) => {
        const fileRec = asRecord(fileNode)
        if (!fileRec) return undefined
        for (const key of keyCandidates) {
            if (key in fileRec) {
                return fileRec[key]
            }
        }
        return undefined
    }

    return contentValue
        .map((value) => {
            const valueRec = asRecord(value)
            if (valueRec) {
                const nodeWithFile = "file" in valueRec ? valueRec.file : undefined
                if (!nodeWithFile) return undefined

                const fileIdProp = normalizeFileProp(nodeWithFile, [
                    "file_id",
                    "fileId",
                    "id",
                    "url",
                ])
                const fileDataProp = normalizeFileProp(nodeWithFile, [
                    "file_data",
                    "fileData",
                    "data",
                ])
                const nameProp = normalizeFileProp(nodeWithFile, ["name", "filename", "file_name"])
                const mimeProp = normalizeFileProp(nodeWithFile, [
                    "mime_type",
                    "mimeType",
                    "content_type",
                    "type",
                    "format",
                ])
                const formatProp = normalizeFileProp(nodeWithFile, ["format", "type"])

                if (!fileIdProp && !fileDataProp) return undefined

                return {
                    fileId: fileIdProp,
                    fileData: fileDataProp,
                    name: nameProp,
                    mimeType: mimeProp,
                    format: formatProp,
                }
            }
            return undefined
        })
        .filter((node) => node != null)
}

// ============================================================================
// CONTENT MUTATION HELPERS
// ============================================================================

/**
 * Update the text content within a message content object.
 * Handles both array content (finds/creates text node) and simple string content.
 */
export function updateTextContent(
    content: AnyObj | undefined,
    newValue: string,
    fallbackId: string,
): AnyObj {
    const c = content || {__id: fallbackId, value: ""}
    const cv = c?.value
    if (Array.isArray(cv)) {
        const idx = cv.findIndex((part) => getNodeType(part) === "text")
        const arr = [...cv]
        if (idx >= 0) {
            const item = asRecord(arr[idx]) || {}
            const textNode = asRecord(item.text) || {}
            arr[idx] = {
                ...item,
                text: {...textNode, value: newValue},
            }
        } else {
            arr.push({
                type: {value: "text"},
                text: {__id: `${c.__id}-text`, value: newValue},
            })
        }
        return {...c, value: arr}
    }
    if (typeof cv === "string") return {...c, value: newValue}
    if (cv && typeof cv === "object" && "value" in cv) return {...c, value: newValue}
    return {...c, value: newValue}
}

/**
 * Remove an upload item (image or file) from array content by its property ID.
 * Returns the new array, or null if the item was not found.
 */
export function removeUploadItem(args: RemoveUploadItemArgs): AnyObj[] | null {
    const {contentProperty, propertyId} = args
    if (!contentProperty || !Array.isArray(contentProperty.value)) return null
    const original = contentProperty.value as AnyObj[]
    const hasProp = (node: unknown, id: string): boolean => {
        if (!node || typeof node !== "object") return false
        const nodeRec = node as AnyObj
        if (nodeRec.__id === id) return true
        for (const key of Object.keys(nodeRec)) {
            if (hasProp(nodeRec[key], id)) return true
        }
        return false
    }
    const index = original.findIndex((part: AnyObj) => hasProp(part, propertyId))
    if (index < 0) return null
    return original.filter((_, i) => i !== index)
}

// ============================================================================
// ATTACHMENT NODE BUILDERS
// ============================================================================

/**
 * Find an attachment option in item metadata by predicate.
 */
function getAttachmentOption(
    itemMetadata: AnyObj | undefined,
    predicate: (part: AnyObj) => boolean,
) {
    const options = Array.isArray(itemMetadata?.options) ? itemMetadata.options : []
    return (options as AnyObj[]).find(predicate) as AnyObj | undefined
}

/**
 * Find the array option in metadata (the compound content array).
 */
function findArrayOption(meta: AnyObj | undefined) {
    const options = Array.isArray(meta?.options) ? meta.options : []
    return (options as AnyObj[]).find((opt) => {
        const option = asRecord(opt)
        if (!option) return false
        const config = asRecord(option.config)
        return option.value === "array" || option.label === "array" || config?.type === "array"
    }) as AnyObj | undefined
}

/**
 * Build an image attachment node, optionally from schema metadata.
 */
export function buildImageNode(
    contentMetaId?: string,
    metadataAccessor?: MetadataAccessor,
    objectFactory?: ObjectFromMetadataFactory,
): AnyObj {
    if (contentMetaId && metadataAccessor && objectFactory) {
        const meta = metadataAccessor(contentMetaId)
        const arrayOption = findArrayOption(meta)
        const arrayConfig = asRecord(arrayOption?.config)
        const itemCompound = asRecord(arrayConfig?.itemMetadata) ?? undefined
        const imageOption = getAttachmentOption(itemCompound, (part: AnyObj) => {
            const props = asRecord(part?.properties)
            return Boolean(props && ("imageUrl" in props || "image_url" in props))
        })
        if (imageOption) {
            const node = objectFactory(imageOption)
            if (node) {
                const typeRec = asRecord(node.type)
                if (typeRec) typeRec.value = "image_url"
                else node.type = {value: "image_url"}
                return node
            }
        }
    }
    return {
        __id: generateId(),
        __metadata: {},
        type: {__id: generateId(), __metadata: {}, value: "image_url"},
        image_url: {
            __id: generateId(),
            __metadata: {},
            url: {__id: generateId(), __metadata: {}, value: ""},
            detail: {__id: generateId(), __metadata: {}, value: "auto"},
        },
    }
}

/**
 * Build a file attachment node, optionally from schema metadata.
 */
export function buildFileNode(
    contentMetaId?: string,
    metadataAccessor?: MetadataAccessor,
    objectFactory?: ObjectFromMetadataFactory,
): AnyObj {
    if (contentMetaId && metadataAccessor && objectFactory) {
        const meta = metadataAccessor(contentMetaId)
        const arrayOption = findArrayOption(meta)
        const arrayConfig = asRecord(arrayOption?.config)
        const itemCompound = asRecord(arrayConfig?.itemMetadata) ?? undefined
        const fileOption = getAttachmentOption(itemCompound, (part: AnyObj) => {
            const props = asRecord(part?.properties)
            return Boolean(props && "file" in props)
        })
        if (fileOption) {
            const node = objectFactory(fileOption)
            if (node) {
                const typeRec = asRecord(node.type)
                if (typeRec) typeRec.value = "file"
                else node.type = {value: "file"}
                return node
            }
        }
    }
    return {
        __id: generateId(),
        __metadata: {},
        type: {__id: generateId(), __metadata: {}, value: "file"},
        file: {
            __id: generateId(),
            __metadata: {},
            file_id: {__id: generateId(), __metadata: {}, value: ""},
            name: {__id: generateId(), __metadata: {}, value: ""},
            mime_type: {__id: generateId(), __metadata: {}, value: ""},
        },
    }
}

/**
 * Build a text node, optionally from schema metadata.
 */
export function buildTextNode(
    contentMetaId?: string,
    metadataAccessor?: MetadataAccessor,
    objectFactory?: ObjectFromMetadataFactory,
): AnyObj {
    if (contentMetaId && metadataAccessor && objectFactory) {
        const meta = metadataAccessor(contentMetaId)
        const arrayOption = findArrayOption(meta)
        const arrayConfig = asRecord(arrayOption?.config)
        const itemCompound = asRecord(arrayConfig?.itemMetadata) ?? undefined
        const textOption = getAttachmentOption(itemCompound, (part: AnyObj) => {
            const props = asRecord(part?.properties)
            return Boolean(props && "text" in props)
        })
        if (textOption) {
            const node = objectFactory(textOption)
            if (node) {
                const typeRec = asRecord(node.type)
                if (typeRec) typeRec.value = "text"
                else node.type = {value: "text"}
                return node
            }
        }
    }
    return {
        __id: generateId(),
        __metadata: {},
        type: {__id: generateId(), __metadata: {}, value: "text"},
        text: {__id: generateId(), __metadata: {}, value: ""},
    }
}

/**
 * Add an upload slot (image or file) to message content.
 * Converts string content to array content if needed.
 */
export function addUploadSlot(
    args: AddUploadSlotArgs,
    metadataAccessor?: MetadataAccessor,
    objectFactory?: ObjectFromMetadataFactory,
): AnyObj[] | null {
    const {contentProperty, max = 5, attachmentType = "image_url"} = args
    const images = Array.isArray(contentProperty?.value)
        ? (contentProperty!.value as AnyObj[]).filter(
              (part: AnyObj) =>
                  getNodeType(part) === attachmentType ||
                  (attachmentType === "image_url" && ("image_url" in part || "imageUrl" in part)) ||
                  (attachmentType === "file" && "file" in part),
          )
        : []
    if (images.length >= max) return null

    const metaId =
        typeof contentProperty?.__metadata === "string" ? contentProperty.__metadata : undefined
    const newNode =
        attachmentType === "file"
            ? buildFileNode(metaId, metadataAccessor, objectFactory)
            : buildImageNode(metaId, metadataAccessor, objectFactory)

    let baseArray: AnyObj[]
    if (Array.isArray(contentProperty?.value)) {
        baseArray = [...(contentProperty!.value as AnyObj[])]
    } else {
        const textNode = buildTextNode(metaId, metadataAccessor, objectFactory)
        const existingText = typeof contentProperty?.value === "string" ? contentProperty.value : ""
        const textProp = asRecord(textNode?.text)
        if (existingText && textProp) {
            textNode.text = {...textProp, value: existingText}
        }
        baseArray = [textNode]
    }
    baseArray.push(newNode)
    return baseArray
}
