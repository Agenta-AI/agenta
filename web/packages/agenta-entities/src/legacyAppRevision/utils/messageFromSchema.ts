/* eslint-disable @typescript-eslint/no-explicit-any */
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

import type {MessageContentPart} from "@agenta/shared/types"
import {generateId} from "@agenta/shared/utils"

import type {ConfigMetadata} from "../state/metadataAtoms"
import {hashConfigMetadata, isObjectMetadata} from "../state/metadataAtoms"

import {createObjectFromMetadata, extractObjectSchemaFromMetadata} from "./metadataHelpers"
import {toSnakeCase} from "./valueExtraction"

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
): Record<string, any> | undefined => {
    const properties: Record<string, any> = {}

    if (isObjectMetadata(metadata)) {
        Object.entries(metadata.properties ?? {}).forEach(([key, propMetadata]) => {
            const metadataHash = hashConfigMetadata(propMetadata)

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
            let value: any = jsonValue

            if (key === "role") {
                if (typeof value === "string") {
                    value = {value}
                }
            } else if (key === "content") {
                let newValue: any
                if (value) {
                    if (typeof value === "string") {
                        const contentMetadata = getMetadataLazy((propMetadata as any).__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )

                        if (
                            objectTypeMetadata?.type === "array" &&
                            (objectTypeMetadata as any).itemMetadata
                        ) {
                            const itemMetadata = (objectTypeMetadata as any).itemMetadata

                            const textOptionMetadata = itemMetadata.options?.find(
                                (opt: any) => "text" in opt.properties,
                            )

                            const textObject: any = createObjectFromMetadata(textOptionMetadata)

                            textObject.type.value = "text"
                            textObject.text.value = value

                            value = {
                                __id: generateId(),
                                __metadata: hashConfigMetadata(objectTypeMetadata),
                                value: [textObject],
                            }
                        }
                    } else if (Array.isArray(value)) {
                        const contentMetadata = getMetadataLazy((value as any)?.__metadata)
                        const objectTypeMetadata = extractObjectSchemaFromMetadata(
                            contentMetadata || propMetadata,
                        )

                        if (
                            objectTypeMetadata?.type === "array" &&
                            (objectTypeMetadata as any).itemMetadata
                        ) {
                            const itemMetadata = (objectTypeMetadata as any).itemMetadata

                            newValue = {
                                __id: generateId(),
                                __metadata: hashConfigMetadata(objectTypeMetadata),
                                value: value.map((item: MessageContentPart) => {
                                    const base: any = createObjectFromMetadata(itemMetadata)

                                    const generatedItem = structuredClone(base)

                                    Object.keys(generatedItem).forEach((k) => {
                                        if (!["__id", "__metadata", "type"].includes(k)) {
                                            delete generatedItem[k]
                                        }
                                    })

                                    generatedItem.type = {
                                        value: item.type,
                                        __id: generateId(),
                                        __metadata: hashConfigMetadata(itemMetadata),
                                    }

                                    if (item.type === "text") {
                                        generatedItem.text = {
                                            __id: generateId(),
                                            value: item.text,
                                            __metadata: hashConfigMetadata(itemMetadata),
                                        }
                                    } else if (item.type === "image_url") {
                                        const imageOptionMetadata = itemMetadata.options?.find(
                                            (opt: any) =>
                                                "image_url" in opt.properties ||
                                                "imageUrl" in opt.properties,
                                        )

                                        const imageBase: any =
                                            createObjectFromMetadata(imageOptionMetadata)
                                        const imageProp = imageBase?.image_url ||
                                            imageBase?.imageUrl || {url: {}, detail: {}}

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

                                        generatedItem.__metadata = imageBase?.__metadata
                                        generatedItem.__id = imageBase?.__id
                                    } else if (item.type === "file") {
                                        const fileOptionMetadata = itemMetadata.options?.find(
                                            (opt: any) => "file" in opt.properties,
                                        )

                                        const fileBase: any =
                                            createObjectFromMetadata(fileOptionMetadata)
                                        const fileProp = fileBase?.file ?? {
                                            __id: generateId(),
                                            __metadata: hashConfigMetadata(itemMetadata),
                                        }
                                        const ensureScalarNode = (node: any) => {
                                            if (node && typeof node === "object") return node
                                            return {
                                                __id: generateId(),
                                                __metadata: hashConfigMetadata(itemMetadata),
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
                                            generatedItem.__metadata = fileBase.__metadata
                                            generatedItem.__id = fileBase.__id
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
                        newValue = createObjectFromMetadata(objectTypeMetadata as any)
                        ;(newValue as any).value[0].type.value = "text"
                        value = newValue
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
                    value = value.map((item: any) => ({
                        __id: generateId(),
                        __metadata: hashConfigMetadata(propMetadata),
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
                    const contentMetadata = getMetadataLazy((propMetadata as any).__metadata)
                    const objectTypeMetadata = extractObjectSchemaFromMetadata(
                        contentMetadata || propMetadata,
                    )

                    if (
                        objectTypeMetadata?.type === "array" &&
                        (objectTypeMetadata as any).itemMetadata
                    ) {
                        const itemMetadata = (objectTypeMetadata as any).itemMetadata
                        const textOptionMetadata = itemMetadata.options?.find(
                            (opt: any) => "text" in opt.properties,
                        )

                        const textObject: any = createObjectFromMetadata(textOptionMetadata)
                        textObject.type.value = "text"
                        textObject.text.value = ""

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
                propMetadata?.type === typeof value &&
                (!(value as any)?.__id || !(value as any)?.__metadata)
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
                    const baseClone: any = structuredClone(baseValue)
                    if ("value" in baseClone) {
                        baseClone.value = null
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
                    ...(baseClone as any),
                    ...value,
                }
            }

            properties[key] = {
                __id: generateId(),
                __metadata: metadataHash,
                ...(value || {}),
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
