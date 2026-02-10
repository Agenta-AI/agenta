import {getMetadataLazy} from "@agenta/entities/legacyAppRevision"
import {generateId} from "@agenta/shared/utils"

import {MessageWithRuns} from "@/oss/lib/hooks/useStatelessVariants/state/types"
import {
    createObjectFromMetadata,
    extractObjectSchemaFromMetadata,
} from "@/oss/lib/shared/variant/genericTransformer/helpers/arrays"
import {toSnakeCase} from "@/oss/lib/shared/variant/stringUtils"

import {isObjectMetadata} from "../../../../../lib/shared/variant/genericTransformer/helpers/metadata"
import type {
    ConfigMetadata,
    Enhanced,
} from "../../../../../lib/shared/variant/genericTransformer/types"
import {hashMetadata} from "../../../assets/hash"
import {ChatContentPart} from "../types"

export const createMessageFromSchema = (
    metadata: ConfigMetadata,
    json?: Record<string, unknown>,
): Enhanced<MessageWithRuns> | undefined => {
    const properties: Record<string, any> = {}

    if (isObjectMetadata(metadata)) {
        Object.entries(metadata.properties).forEach(([key, propMetadata]) => {
            const metadataHash = hashMetadata(propMetadata)

            const baseValue = createObjectFromMetadata(propMetadata as ConfigMetadata)

            if (
                baseValue &&
                typeof baseValue === "object" &&
                !Array.isArray(baseValue) &&
                "value" in baseValue
            ) {
                const primitiveType = (propMetadata as any)?.type

                if (primitiveType === "number" && (baseValue as any).value === "") {
                    ;(baseValue as any).value = (propMetadata as any)?.nullable ? null : 0
                } else if (primitiveType === "boolean" && (baseValue as any).value === "") {
                    ;(baseValue as any).value = (propMetadata as any)?.nullable ? null : false
                }
            }

            if (
                key === "role" &&
                baseValue &&
                typeof baseValue === "object" &&
                !Array.isArray(baseValue) &&
                "value" in baseValue
            ) {
                ;(baseValue as any).value = "user"
            }

            const jsonValue = json?.[key] ?? json?.[toSnakeCase(key)]
            let value = jsonValue

            if (key === "role") {
                if (typeof value === "string") {
                    value = {value}
                }
            } else if (key === "content") {
                let newValue
                if (value) {
                    if (typeof value === "string") {
                        const contentMetadata = getMetadataLazy(propMetadata.__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )

                        if (
                            objectTypeMetadata?.type === "array" &&
                            objectTypeMetadata.itemMetadata
                        ) {
                            const itemMetadata = objectTypeMetadata.itemMetadata

                            const textOptionMetadata = itemMetadata.options?.find(
                                (opt) => "text" in opt.properties,
                            )

                            const textObject = createObjectFromMetadata(textOptionMetadata)

                            textObject.type.value = "text"
                            textObject.text.value = value

                            value = {
                                __id: generateId(),
                                __metadata: hashMetadata(objectTypeMetadata),
                                value: [textObject],
                            }
                        }
                    } else if (Array.isArray(value)) {
                        const contentMetadata = getMetadataLazy(value?.__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )

                        if (
                            objectTypeMetadata?.type === "array" &&
                            objectTypeMetadata.itemMetadata
                        ) {
                            const itemMetadata = objectTypeMetadata.itemMetadata

                            newValue = {
                                __id: generateId(),
                                __metadata: hashMetadata(objectTypeMetadata),
                                value: value.map((item: ChatContentPart) => {
                                    const base = createObjectFromMetadata(itemMetadata)

                                    const generatedItem = structuredClone(base)

                                    Object.keys(generatedItem).forEach((key) => {
                                        if (!["__id", "__metadata", "type"].includes(key)) {
                                            delete generatedItem[key]
                                        }
                                    })

                                    generatedItem.type = {
                                        value: item.type,
                                        __id: generateId(),
                                        __metadata: hashMetadata(itemMetadata),
                                    }

                                    if (item.type === "text") {
                                        generatedItem.text = {
                                            __id: generateId(),
                                            value: item.text,
                                            __metadata: hashMetadata(itemMetadata),
                                        }
                                    } else if (item.type === "image_url") {
                                        const imageOptionMetadata = itemMetadata.options?.find(
                                            (opt) =>
                                                "image_url" in opt.properties ||
                                                "imageUrl" in opt.properties,
                                        )

                                        const imageBase =
                                            createObjectFromMetadata(imageOptionMetadata)
                                        const imageProp = (imageBase as any).image_url ||
                                            (imageBase as any).imageUrl || {url: {}, detail: {}}

                                        generatedItem.image_url = {
                                            ...imageProp,
                                            url: {
                                                ...imageProp?.url,
                                                value: item.image_url?.url || "",
                                            },
                                            detail: {
                                                ...imageProp?.detail,
                                                value: item.image_url?.detail || "auto",
                                            },
                                        }

                                        generatedItem.__metadata = (imageBase as any).__metadata
                                        generatedItem.__id = (imageBase as any).__id
                                    } else if (item.type === "file") {
                                        const fileOptionMetadata = itemMetadata.options?.find(
                                            (opt) => "file" in opt.properties,
                                        )

                                        const fileBase =
                                            createObjectFromMetadata(fileOptionMetadata)
                                        const fileProp = (fileBase as any)?.file ?? {
                                            __id: generateId(),
                                            __metadata: hashMetadata(itemMetadata),
                                        }
                                        const ensureScalarNode = (node: any) => {
                                            if (node && typeof node === "object") return node
                                            return {
                                                __id: generateId(),
                                                __metadata: hashMetadata(itemMetadata),
                                                value: "",
                                            }
                                        }

                                        generatedItem.file = {
                                            ...fileProp,
                                            file_id: {
                                                ...ensureScalarNode(fileProp?.file_id),
                                                value: item.file?.file_id || "",
                                            },
                                            file_data: {
                                                ...ensureScalarNode(fileProp?.file_data),
                                                value: item.file?.file_data || "",
                                            },
                                            name: {
                                                ...ensureScalarNode(fileProp?.name),
                                                value: item.file?.name || item.file?.filename || "",
                                            },
                                            filename: {
                                                ...ensureScalarNode(fileProp?.filename),
                                                value: item.file?.filename || item.file?.name || "",
                                            },
                                            mime_type: {
                                                ...ensureScalarNode(fileProp?.mime_type),
                                                value:
                                                    item.file?.mime_type || item.file?.format || "",
                                            },
                                            format: {
                                                ...ensureScalarNode(fileProp?.format),
                                                value:
                                                    item.file?.format || item.file?.mime_type || "",
                                            },
                                        }

                                        if (fileBase) {
                                            generatedItem.__metadata = (fileBase as any).__metadata
                                            generatedItem.__id = (fileBase as any).__id
                                        }
                                    }

                                    return generatedItem
                                }),
                            }

                            value = newValue
                        }
                    } else if (!value?.value) {
                        const contentMetadata = getMetadataLazy(value?.__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )
                        newValue = createObjectFromMetadata(objectTypeMetadata)
                        newValue.value[0].type.value = "text"
                        value = newValue
                    }
                } else {
                    value = {
                        __id: generateId(),
                        __metadata: hashMetadata(propMetadata),
                        value,
                    }
                }
            } else if (key === "toolCalls") {
                if (Array.isArray(value)) {
                    value = value.map((item) => ({
                        __id: generateId(),
                        __metadata: hashMetadata(propMetadata),
                        ...structuredClone(item),
                    }))
                }
            }

            if (key === "content") {
                if (
                    value === undefined ||
                    value === null ||
                    value.value === null ||
                    value.value === undefined
                ) {
                    const contentMetadata = getMetadataLazy(propMetadata.__metadata)
                    const objectTypeMetadata = extractObjectSchemaFromMetadata(
                        contentMetadata || propMetadata,
                    )

                    if (objectTypeMetadata?.type === "array" && objectTypeMetadata.itemMetadata) {
                        const itemMetadata = objectTypeMetadata.itemMetadata
                        const textOptionMetadata = itemMetadata.options?.find(
                            (opt) => "text" in opt.properties,
                        )

                        const textObject = createObjectFromMetadata(textOptionMetadata)
                        textObject.type.value = "text"
                        textObject.text.value = ""

                        value = {
                            __id: generateId(),
                            __metadata: hashMetadata(objectTypeMetadata),
                            value: [textObject],
                        }
                    }
                }
            } else if (key === "toolCalls") {
                if (!value || (Array.isArray(value) && value.length === 0)) {
                    return
                } else {
                    value = {
                        value,
                    }
                }
            }

            if (
                (typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean") &&
                propMetadata?.type === typeof value &&
                (!value?.__id || !value?.__metadata)
            ) {
                value = {value}
            }

            const baseIsObject =
                baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)

            if (value === undefined) {
                if (baseIsObject) {
                    value = structuredClone(baseValue)
                }
            } else if (value === null) {
                if (baseIsObject) {
                    const baseClone = structuredClone(baseValue)
                    if ("value" in baseClone) {
                        ;(baseClone as any).value = null
                    }
                    value = baseClone
                } else {
                    value = {value: null}
                }
            } else if (
                baseIsObject &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                (!("__id" in value) || !("__metadata" in value))
            ) {
                const baseClone = structuredClone(baseValue)
                value = {
                    ...baseClone,
                    ...value,
                }
            }

            properties[key] = {
                __id: generateId(),
                __metadata: metadataHash,
                ...(value || {}),
            }
        })
        const metadataHash = hashMetadata(metadata)

        const generated = {
            __id: generateId(),
            __metadata: metadataHash,
            ...properties,
        } as Enhanced<MessageWithRuns>

        return generated
    } else {
        return undefined
    }
}
