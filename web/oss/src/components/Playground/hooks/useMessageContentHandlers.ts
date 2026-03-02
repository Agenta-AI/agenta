import {useCallback} from "react"

import {getMetadataLazy} from "@agenta/entities/legacyAppRevision"
import {generateId} from "@agenta/shared/utils"

import {createObjectFromMetadata} from "@/oss/lib/shared/variant/genericTransformer/helpers/arrays"

type AnyObj = Record<string, any>

export interface ComputeDisplayValueArgs {
    propsInitialValue?: string
    value: any
    isFunction: boolean
    isTool: boolean
    contentProperty?: {value?: any}
}

export type AttachmentNodeType = "image_url" | "file"

export interface AddUploadSlotArgs {
    contentProperty?: {__metadata?: string; value?: any}
    max?: number
    attachmentType?: AttachmentNodeType
}

export interface RemoveUploadItemArgs {
    contentProperty?: {value?: any}
    propertyId: string
}

export function useMessageContentHandlers() {
    const computeDisplayValue = useCallback((args: ComputeDisplayValueArgs) => {
        const {propsInitialValue, value, isFunction, isTool, contentProperty} = args
        if (isFunction) {
            return propsInitialValue || value
        } else if (isTool) {
            const x = value
            if (Array.isArray(x)) {
                const textNode = x.filter(
                    (part) => part && typeof part === "object" && "text" in part,
                )
                return textNode.map((part: AnyObj) => part.text.value).join("")
            }
            return x || ""
        } else {
            const source = (contentProperty as AnyObj)?.value ?? value
            const raw = source as any
            const x = raw && typeof raw === "object" && "value" in raw ? raw.value : raw
            if (Array.isArray(x)) {
                const textNodes = x.filter((part) => {
                    if (!part || typeof part !== "object") return false
                    const hasText = "text" in part
                    const isTextType = (part as AnyObj)?.type?.value === "text"
                    return hasText && isTextType
                })
                return textNodes.map((part: AnyObj) => part.text?.value || "").join("")
            }
            return (typeof x === "string" ? x : "") || ""
        }
    }, [])

    const buildImageNode = useCallback((contentMetaId?: string) => {
        let imageNode: AnyObj | null = null
        if (contentMetaId) {
            const meta: AnyObj | undefined = getMetadataLazy(contentMetaId) as any
            // For compound content: find the array option and then the image object option
            const arrayOption = (meta?.options || []).find(
                (opt: AnyObj) =>
                    opt?.value === "array" ||
                    opt?.label === "array" ||
                    opt?.config?.type === "array",
            ) as AnyObj | undefined
            const itemCompound = arrayOption?.config?.itemMetadata as AnyObj | undefined
            const imageOption = (itemCompound?.options || []).find((part: AnyObj) => {
                const props = (part as AnyObj)?.properties
                return (
                    props &&
                    typeof props === "object" &&
                    ("imageUrl" in props || "image_url" in props)
                )
            }) as AnyObj | undefined
            if (imageOption) imageNode = createObjectFromMetadata(imageOption)
            if (imageNode) imageNode.type.value = "image_url"
        }
        if (!imageNode) {
            imageNode = {
                __id: generateId(),
                __metadata: {},
                type: {
                    __id: generateId(),
                    __metadata: {},
                    value: "image_url",
                },
                image_url: {
                    __id: generateId(),
                    __metadata: {},
                    url: {
                        __id: generateId(),
                        __metadata: {},
                        value: "",
                    },
                    detail: {
                        __id: generateId(),
                        __metadata: {},
                        value: "auto",
                    },
                },
            }
        }
        return imageNode
    }, [])

    const getAttachmentOption = (
        itemMetadata: AnyObj | undefined,
        predicate: (part: AnyObj) => boolean,
    ) => {
        return (itemMetadata?.options || []).find(predicate) as AnyObj | undefined
    }

    const buildFileNode = useCallback((contentMetaId?: string) => {
        let fileNode: AnyObj | null = null
        if (contentMetaId) {
            const meta: AnyObj | undefined = getMetadataLazy(contentMetaId) as any
            const arrayOption = (meta?.options || []).find(
                (opt: AnyObj) =>
                    opt?.value === "array" ||
                    opt?.label === "array" ||
                    opt?.config?.type === "array",
            ) as AnyObj | undefined
            const itemCompound = arrayOption?.config?.itemMetadata as AnyObj | undefined
            const fileOption = getAttachmentOption(itemCompound, (part: AnyObj) => {
                const props = (part as AnyObj)?.properties
                return props && typeof props === "object" && "file" in props
            })
            if (fileOption) fileNode = createObjectFromMetadata(fileOption)
            if (fileNode) fileNode.type.value = "file"
        }
        if (!fileNode) {
            fileNode = {
                __id: generateId(),
                __metadata: {},
                type: {
                    __id: generateId(),
                    __metadata: {},
                    value: "file",
                },
                file: {
                    __id: generateId(),
                    __metadata: {},
                    file_id: {
                        __id: generateId(),
                        __metadata: {},
                        value: "",
                    },
                    name: {
                        __id: generateId(),
                        __metadata: {},
                        value: "",
                    },
                    mime_type: {
                        __id: generateId(),
                        __metadata: {},
                        value: "",
                    },
                },
            }
        }
        return fileNode
    }, [])

    const buildTextNode = useCallback((contentMetaId?: string) => {
        let textNode: AnyObj | null = null
        if (contentMetaId) {
            const meta: AnyObj | undefined = getMetadataLazy(contentMetaId) as any
            const arrayOption = (meta?.options || []).find(
                (opt: AnyObj) =>
                    opt?.value === "array" ||
                    opt?.label === "array" ||
                    opt?.config?.type === "array",
            ) as AnyObj | undefined
            const itemCompound = arrayOption?.config?.itemMetadata as AnyObj | undefined
            const textItemMetadata = (itemCompound?.options || []).find((part: AnyObj) => {
                const props = (part as AnyObj)?.properties
                return props && typeof props === "object" && "text" in props
            }) as AnyObj | undefined
            if (textItemMetadata) textNode = createObjectFromMetadata(textItemMetadata)
            if (textNode) (textNode as AnyObj).type.value = "text"
        }
        if (!textNode) {
            textNode = {
                __id: generateId(),
                __metadata: {},
                type: {__id: generateId(), __metadata: {}, value: "text"},
                text: {__id: generateId(), __metadata: {}, value: ""},
            }
        }
        return textNode
    }, [])

    const addUploadSlot = useCallback(
        (args: AddUploadSlotArgs) => {
            const {contentProperty, max = 5, attachmentType = "image_url"} = args
            const images = Array.isArray(contentProperty?.value)
                ? (contentProperty!.value as AnyObj[]).filter(
                      (part: AnyObj) =>
                          part &&
                          typeof part === "object" &&
                          ((part?.type?.value ?? part?.type) === attachmentType ||
                              (attachmentType === "image_url" &&
                                  ("image_url" in part || "imageUrl" in part)) ||
                              (attachmentType === "file" && "file" in part)),
                  )
                : []
            if (images.length >= max) return null

            const newNode =
                attachmentType === "file"
                    ? buildFileNode((contentProperty as AnyObj)?.__metadata)
                    : buildImageNode((contentProperty as AnyObj)?.__metadata)

            let baseArray: AnyObj[]
            if (Array.isArray(contentProperty?.value)) {
                baseArray = [...(contentProperty!.value as AnyObj[])]
            } else {
                const textNode = buildTextNode((contentProperty as AnyObj)?.__metadata)
                // Preserve existing text when converting from string to array
                const existingText =
                    typeof contentProperty?.value === "string" ? contentProperty.value : ""
                if (existingText && textNode?.text) {
                    textNode.text = {...textNode.text, value: existingText}
                }
                baseArray = [textNode]
            }
            baseArray.push(newNode)
            return baseArray
        },
        [buildFileNode, buildImageNode, buildTextNode],
    )

    const updateTextContent = useCallback(
        (content: AnyObj | undefined, newValue: string, fallbackId: string) => {
            const c = content || {__id: fallbackId, value: ""}
            const cv = c?.value
            if (Array.isArray(cv)) {
                const idx = cv.findIndex((p: any) => (p?.type?.value ?? p?.type) === "text")
                const arr = [...cv]
                if (idx >= 0) {
                    const item = arr[idx]
                    arr[idx] = {
                        ...item,
                        text: {...item.text, value: newValue},
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
        },
        [],
    )

    const removeUploadItem = useCallback(
        (args: {contentProperty?: {value?: any}; propertyId: string}): any[] | null => {
            const {contentProperty, propertyId} = args
            if (!contentProperty || !Array.isArray(contentProperty.value)) return null
            const original = contentProperty.value as AnyObj[]
            const hasProp = (node: any, id: string): boolean => {
                if (!node || typeof node !== "object") return false
                if ((node as AnyObj).__id === id) return true
                for (const k of Object.keys(node)) {
                    if (hasProp((node as AnyObj)[k], id)) return true
                }
                return false
            }
            const index = original.findIndex((part: AnyObj) => hasProp(part, propertyId))
            if (index < 0) return null
            // Return a new array without mutating the original; no deep clone required
            return original.filter((_, i) => i !== index)
        },
        [],
    )

    return {computeDisplayValue, addUploadSlot, updateTextContent, removeUploadItem}
}
