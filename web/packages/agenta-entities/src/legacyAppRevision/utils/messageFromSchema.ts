/**
 * Create an Enhanced message PropertyNode tree from a ConfigMetadata schema.
 *
 * This is the canonical way to produce schema-driven message objects
 * (the `{__id, __metadata, value}` tree) from plain JSON data.
 * It handles role, content (string / array of content parts), toolCalls,
 * and arbitrary extra properties defined in the schema.
 *
 * Moved from OSS `messageHelpers.ts` — all building blocks already live in
 * `@agenta/entities/legacyAppRevision`.
 */

import {generateId} from "@agenta/shared/utils"

import type {ConfigMetadata, ObjectMetadata} from "../types/enhanced"

import {
    createObjectFromMetadata,
    extractObjectSchemaFromMetadata,
    hashConfigMetadata,
} from "./metadataHelpers"
import {toSnakeCase} from "./valueExtraction"

function isObjectMetadata(metadata: ConfigMetadata): metadata is ObjectMetadata {
    return metadata?.type === "object"
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {})

const isConfigMetadata = (value: unknown): value is ConfigMetadata =>
    isRecord(value) && typeof value["type"] === "string"

const isValueNode = (value: unknown): value is UnknownRecord & {value: unknown} =>
    isRecord(value) && "value" in value

const getLinkedMetadata = (source: unknown): ConfigMetadata | undefined => {
    const metadataHash = asRecord(source)["__metadata"]
    return typeof metadataHash === "string" ? getMetadataLazy(metadataHash) : undefined
}

const getArrayItemMetadata = (metadata: ConfigMetadata | null): ConfigMetadata | undefined => {
    if (!metadata || metadata.type !== "array") return undefined
    const itemMetadata = asRecord(metadata)["itemMetadata"]
    return isConfigMetadata(itemMetadata) ? itemMetadata : undefined
}

const getOptionByProperty = (
    metadata: ConfigMetadata,
    propertyName: string,
): ConfigMetadata | undefined => {
    const options = asRecord(metadata)["options"]
    if (!Array.isArray(options)) return undefined

    const match = options.find((option) => {
        const properties = asRecord(asRecord(option)["properties"])
        return propertyName in properties
    })

    return isConfigMetadata(match) ? match : undefined
}

const setNodeValue = (parent: UnknownRecord, key: string, value: unknown): void => {
    const node = asRecord(parent[key])
    node["value"] = value
    parent[key] = node
}

const ensureScalarNode = (node: unknown, metadataHash: string): UnknownRecord => {
    if (isRecord(node)) return node
    return {
        __id: generateId(),
        __metadata: metadataHash,
        value: "",
    }
}

const createTextContentObject = (itemMetadata: ConfigMetadata, text: string): UnknownRecord => {
    const textOptionMetadata = getOptionByProperty(itemMetadata, "text")
    const textObject = asRecord(createObjectFromMetadata(textOptionMetadata ?? itemMetadata))
    setNodeValue(textObject, "type", "text")
    setNodeValue(textObject, "text", text)
    return textObject
}

const asStringOrEmpty = (value: unknown): string => (typeof value === "string" ? value : "")

// ---------------------------------------------------------------------------
// Metadata accessor — avoids circular imports with the molecule/store.
// Consumers must call `setMessageSchemaMetadataAccessor` once at init time.
// ---------------------------------------------------------------------------

let _getMetadataLazy: ((hash: string) => ConfigMetadata | undefined) | undefined

export function setMessageSchemaMetadataAccessor(fn: (hash: string) => ConfigMetadata | undefined) {
    _getMetadataLazy = fn
}

function getMetadataLazy(hash: string): ConfigMetadata | undefined {
    return _getMetadataLazy?.(hash)
}

// ---------------------------------------------------------------------------
// createMessageFromSchema
// ---------------------------------------------------------------------------

export const createMessageFromSchema = (
    metadata: ConfigMetadata,
    json?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
    const properties: Record<string, unknown> = {}

    if (isObjectMetadata(metadata)) {
        Object.entries(metadata.properties ?? {}).forEach(([key, propMetadata]) => {
            const metadataHash = hashConfigMetadata(propMetadata)

            const baseValue = createObjectFromMetadata(propMetadata)

            if (isValueNode(baseValue)) {
                const primitiveType = propMetadata.type

                if (primitiveType === "number" && baseValue.value === "") {
                    baseValue.value = propMetadata.nullable ? null : 0
                } else if (primitiveType === "boolean" && baseValue.value === "") {
                    baseValue.value = propMetadata.nullable ? null : false
                }
            }

            if (key === "role" && isValueNode(baseValue)) {
                baseValue.value = "user"
            }

            const jsonValue = json?.[key] ?? json?.[toSnakeCase(key)]
            let value: unknown = jsonValue

            if (key === "role") {
                if (typeof value === "string") {
                    value = {value}
                }
            } else if (key === "content") {
                if (value) {
                    if (typeof value === "string") {
                        const contentMetadata = getLinkedMetadata(propMetadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )
                        const itemMetadata = getArrayItemMetadata(objectTypeMetadata)

                        if (objectTypeMetadata && itemMetadata) {
                            const textObject = createTextContentObject(itemMetadata, value)

                            value = {
                                __id: generateId(),
                                __metadata: hashConfigMetadata(objectTypeMetadata),
                                value: [textObject],
                            }
                        }
                    } else if (Array.isArray(value)) {
                        const contentMetadata = getLinkedMetadata(value)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )
                        const itemMetadata = getArrayItemMetadata(objectTypeMetadata)

                        if (objectTypeMetadata && itemMetadata) {
                            const itemMetadataHash = hashConfigMetadata(itemMetadata)

                            const mappedContent = value.map((item) => {
                                const part = asRecord(item)
                                const generatedItem = structuredClone(
                                    asRecord(createObjectFromMetadata(itemMetadata)),
                                )

                                Object.keys(generatedItem).forEach((k) => {
                                    if (!["__id", "__metadata", "type"].includes(k)) {
                                        delete generatedItem[k]
                                    }
                                })

                                const itemType = asStringOrEmpty(part["type"])
                                setNodeValue(generatedItem, "type", itemType)

                                if (itemType === "text") {
                                    setNodeValue(
                                        generatedItem,
                                        "text",
                                        asStringOrEmpty(part["text"]),
                                    )
                                } else if (itemType === "image_url") {
                                    const imageOptionMetadata =
                                        getOptionByProperty(itemMetadata, "image_url") ??
                                        getOptionByProperty(itemMetadata, "imageUrl")

                                    const imageBase = imageOptionMetadata
                                        ? asRecord(createObjectFromMetadata(imageOptionMetadata))
                                        : {}
                                    const imageProp = asRecord(
                                        imageBase["image_url"] ??
                                            imageBase["imageUrl"] ?? {
                                                url: {},
                                                detail: {},
                                            },
                                    )

                                    const imageUrl = asRecord(part["image_url"])
                                    const detail = imageUrl["detail"]

                                    generatedItem["image_url"] = {
                                        ...imageProp,
                                        url: {
                                            ...asRecord(imageProp["url"]),
                                            value: asStringOrEmpty(imageUrl["url"]),
                                        },
                                        detail: {
                                            ...asRecord(imageProp["detail"]),
                                            value:
                                                detail === "auto" ||
                                                detail === "low" ||
                                                detail === "high"
                                                    ? detail
                                                    : "auto",
                                        },
                                    }

                                    if (typeof imageBase["__metadata"] === "string") {
                                        generatedItem["__metadata"] = imageBase["__metadata"]
                                    }
                                    if (typeof imageBase["__id"] === "string") {
                                        generatedItem["__id"] = imageBase["__id"]
                                    }
                                } else if (itemType === "file") {
                                    const fileOptionMetadata = getOptionByProperty(
                                        itemMetadata,
                                        "file",
                                    )

                                    const fileBase = fileOptionMetadata
                                        ? asRecord(createObjectFromMetadata(fileOptionMetadata))
                                        : {}
                                    const fileProp = asRecord(
                                        fileBase["file"] ?? {
                                            __id: generateId(),
                                            __metadata: itemMetadataHash,
                                        },
                                    )
                                    const file = asRecord(part["file"])

                                    generatedItem["file"] = {
                                        ...fileProp,
                                        file_id: {
                                            ...ensureScalarNode(
                                                fileProp["file_id"],
                                                itemMetadataHash,
                                            ),
                                            value: asStringOrEmpty(file["file_id"]),
                                        },
                                        file_data: {
                                            ...ensureScalarNode(
                                                fileProp["file_data"],
                                                itemMetadataHash,
                                            ),
                                            value: asStringOrEmpty(file["file_data"]),
                                        },
                                        name: {
                                            ...ensureScalarNode(fileProp["name"], itemMetadataHash),
                                            value:
                                                asStringOrEmpty(file["name"]) ||
                                                asStringOrEmpty(file["filename"]),
                                        },
                                        filename: {
                                            ...ensureScalarNode(
                                                fileProp["filename"],
                                                itemMetadataHash,
                                            ),
                                            value:
                                                asStringOrEmpty(file["filename"]) ||
                                                asStringOrEmpty(file["name"]),
                                        },
                                        mime_type: {
                                            ...ensureScalarNode(
                                                fileProp["mime_type"],
                                                itemMetadataHash,
                                            ),
                                            value:
                                                asStringOrEmpty(file["mime_type"]) ||
                                                asStringOrEmpty(file["format"]),
                                        },
                                        format: {
                                            ...ensureScalarNode(
                                                fileProp["format"],
                                                itemMetadataHash,
                                            ),
                                            value:
                                                asStringOrEmpty(file["format"]) ||
                                                asStringOrEmpty(file["mime_type"]),
                                        },
                                    }

                                    if (fileBase["__metadata"] !== undefined) {
                                        generatedItem["__metadata"] = fileBase["__metadata"]
                                    }
                                    if (fileBase["__id"] !== undefined) {
                                        generatedItem["__id"] = fileBase["__id"]
                                    }
                                }

                                return generatedItem
                            })

                            value = {
                                __id: generateId(),
                                __metadata: hashConfigMetadata(objectTypeMetadata),
                                value: mappedContent,
                            }
                        }
                    } else {
                        const existingValueNode = asRecord(value)
                        if (!existingValueNode["value"]) {
                            const contentMetadata = getLinkedMetadata(value)
                            const objectTypeMetadata = extractObjectSchemaFromMetadata(
                                contentMetadata || propMetadata,
                            )

                            if (objectTypeMetadata) {
                                const newValue = asRecord(
                                    createObjectFromMetadata(objectTypeMetadata),
                                )
                                const items = newValue["value"]

                                if (Array.isArray(items) && items.length > 0) {
                                    const firstItem = asRecord(items[0])
                                    setNodeValue(firstItem, "type", "text")
                                    items[0] = firstItem
                                    newValue["value"] = items
                                }

                                value = newValue
                            }
                        }
                    }
                } else {
                    value = {
                        __id: generateId(),
                        __metadata: hashConfigMetadata(propMetadata),
                        value,
                    }
                }
            } else if (key === "toolCalls") {
                if (Array.isArray(value)) {
                    value = value.map((item) => ({
                        __id: generateId(),
                        __metadata: hashConfigMetadata(propMetadata),
                        ...asRecord(structuredClone(item)),
                    }))
                }
            }

            if (key === "content") {
                const valueRecord = asRecord(value)

                if (
                    value === undefined ||
                    value === null ||
                    valueRecord["value"] === null ||
                    valueRecord["value"] === undefined
                ) {
                    const contentMetadata = getLinkedMetadata(propMetadata)
                    const objectTypeMetadata = extractObjectSchemaFromMetadata(
                        contentMetadata || propMetadata,
                    )
                    const itemMetadata = getArrayItemMetadata(objectTypeMetadata)

                    if (objectTypeMetadata && itemMetadata) {
                        const textObject = createTextContentObject(itemMetadata, "")

                        value = {
                            __id: generateId(),
                            __metadata: hashConfigMetadata(objectTypeMetadata),
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
                propMetadata?.type === typeof value
            ) {
                value = {value}
            }

            const baseIsObject = isRecord(baseValue)

            if (value === undefined) {
                if (baseIsObject) {
                    value = structuredClone(baseValue)
                }
            } else if (value === null) {
                if (baseIsObject) {
                    const baseClone = asRecord(structuredClone(baseValue))
                    if ("value" in baseClone) {
                        baseClone["value"] = null
                    }
                    value = baseClone
                } else {
                    value = {value: null}
                }
            } else if (
                baseIsObject &&
                isRecord(value) &&
                (!("__id" in value) || !("__metadata" in value))
            ) {
                const baseClone = asRecord(structuredClone(baseValue))
                value = {
                    ...baseClone,
                    ...value,
                }
            }

            const valuePayload = isRecord(value) ? value : value === undefined ? {} : {value}

            properties[key] = {
                __id: generateId(),
                __metadata: metadataHash,
                ...valuePayload,
            }
        })
        const metadataHash = hashConfigMetadata(metadata)

        const generated = {
            __id: generateId(),
            __metadata: metadataHash,
            ...properties,
        }

        return generated
    } else {
        return undefined
    }
}
