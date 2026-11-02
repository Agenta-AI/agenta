/**
 * Attachment extraction for trace/span payloads.
 *
 * Walks an arbitrary payload, converts embedded base64 data URIs to object URLs,
 * and collects the file/image attachments it found along the way.
 */
import {dataUriToObjectUrl, isBase64} from "./dataUri"

export interface FileAttachment {
    filename: string
    data: string
    format?: string
    size?: number | string
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
    !!value && typeof value === "object" && !Array.isArray(value)

const asOptionalString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined

const asOptionalSize = (value: unknown): number | string | undefined =>
    typeof value === "number" || typeof value === "string" ? value : undefined

export const sanitizeDataWithBlobUrls = <T = unknown>(
    input: T,
): {
    data: T
    blobUrls: string[]
    fileAttachments: FileAttachment[]
    imageAttachments: FileAttachment[]
} => {
    const blobUrls: string[] = []
    const fileAttachments: FileAttachment[] = []
    const imageAttachments: FileAttachment[] = []
    const seenFileData = new Set<string>()
    const seenImageData = new Set<string>()
    const base64UrlCache = new Map<string, string>()

    const getOrCreateBlobUrl = (value: string) => {
        const cached = base64UrlCache.get(value)
        if (cached) return cached
        const url = dataUriToObjectUrl(value)
        base64UrlCache.set(value, url)
        blobUrls.push(url)
        return url
    }

    const convertString = (value: unknown) => {
        if (typeof value === "string" && isBase64(value)) {
            return getOrCreateBlobUrl(value)
        }
        return value
    }

    const extractStringValue = (value: unknown): string | null => {
        if (!value) return null
        if (typeof value === "string") return value
        if (Array.isArray(value)) {
            for (const item of value) {
                const nested = extractStringValue(item)
                if (nested) return nested
            }
            return null
        }
        if (typeof value === "object") {
            const prioritizedKeys = ["url", "value", "data", "href", "src"]
            for (const key of prioritizedKeys) {
                if (key in value) {
                    const nested = extractStringValue((value as UnknownRecord)[key])
                    if (nested) return nested
                }
            }
        }
        return null
    }

    const addImageAttachment = (
        candidate: unknown,
        meta: {filename?: string; format?: string; size?: number | string} = {},
    ) => {
        if (!candidate) return
        if (Array.isArray(candidate)) {
            candidate.forEach((entry) =>
                addImageAttachment(entry, {
                    filename: meta.filename,
                    format: meta.format,
                    size: meta.size,
                }),
            )
            return
        }

        const rawValue = extractStringValue(candidate)
        if (!rawValue || typeof rawValue !== "string" || rawValue.length === 0) return
        const resolved = convertString(rawValue)
        if (typeof resolved !== "string" || resolved.length === 0) return

        if (seenImageData.has(resolved)) return
        seenImageData.add(resolved)

        imageAttachments.push({
            filename: meta.filename || "Image",
            format: meta.format,
            size: meta.size,
            data: resolved,
        })
    }

    const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) {
            return node.map((item) => walk(item))
        }
        if (node && typeof node === "object") {
            const cloned: UnknownRecord = {}
            Object.entries(node).forEach(([key, value]) => {
                const sanitized = walk(value)
                cloned[key] = sanitized
            })
            const fileData = cloned.file_data ?? cloned.fileData
            const fileId = cloned.file_id ?? cloned.fileId
            const filename = cloned.filename ?? cloned.name ?? cloned.file_name
            const format = cloned.format ?? cloned.file_format
            const size = cloned.size ?? cloned.file_size
            const dataCandidate = typeof fileId === "string" && fileId ? fileId : fileData
            if (typeof dataCandidate === "string" && dataCandidate.length) {
                const shouldConvert = isBase64(dataCandidate)
                const resolved = shouldConvert ? getOrCreateBlobUrl(dataCandidate) : dataCandidate
                if (!seenFileData.has(resolved)) {
                    seenFileData.add(resolved)
                    fileAttachments.push({
                        filename: asOptionalString(filename) || "Document",
                        format: asOptionalString(format),
                        size: asOptionalSize(size),
                        data: resolved,
                    })
                }
                if (cloned.file_data) cloned.file_data = resolved
                if (cloned.fileData) cloned.fileData = resolved
                if (cloned.file_id) cloned.file_id = resolved
                if (cloned.fileId) cloned.fileId = resolved
            }

            const directImage = cloned.image_url ?? cloned.imageUrl
            if (directImage) {
                const image = isRecord(directImage) ? directImage : undefined
                addImageAttachment(directImage, {
                    filename: asOptionalString(
                        image?.filename ?? image?.name ?? cloned.filename ?? cloned.name,
                    ),
                    format: asOptionalString(image?.format ?? image?.type),
                    size: asOptionalSize(image?.size),
                })
            }

            const directImageValue = cloned.image ?? cloned.imageValue
            if (directImageValue) {
                const image = isRecord(directImageValue) ? directImageValue : undefined
                addImageAttachment(directImageValue, {
                    filename: asOptionalString(
                        image?.filename ?? image?.name ?? cloned.filename ?? cloned.name,
                    ),
                    format: asOptionalString(image?.format ?? image?.type),
                })
            }

            const imageCollections = [cloned.image_urls, cloned.imageUrls, cloned.images]
            imageCollections.forEach((collection) => {
                if (!collection) return
                if (Array.isArray(collection)) {
                    collection.forEach((item: unknown, index: number) => {
                        const image = isRecord(item) ? item : undefined
                        addImageAttachment(item, {
                            filename: asOptionalString(
                                image?.filename ??
                                    image?.name ??
                                    cloned.filename ??
                                    `Image ${index + 1}`,
                            ),
                            format: asOptionalString(image?.format ?? image?.type),
                            size: asOptionalSize(image?.size),
                        })
                    })
                } else {
                    const image = isRecord(collection) ? collection : undefined
                    addImageAttachment(collection, {
                        filename: asOptionalString(
                            image?.filename ?? image?.name ?? cloned.filename ?? cloned.name,
                        ),
                        format: asOptionalString(image?.format ?? image?.type),
                        size: asOptionalSize(image?.size),
                    })
                }
            })

            if (cloned.type === "image_url" && cloned.url) {
                addImageAttachment(cloned.url, {
                    filename: asOptionalString(cloned.filename ?? cloned.name),
                    format: asOptionalString(cloned.format),
                    size: asOptionalSize(cloned.size),
                })
            }

            return cloned
        }
        return convertString(node)
    }

    return {data: walk(input) as T, blobUrls, fileAttachments, imageAttachments}
}
