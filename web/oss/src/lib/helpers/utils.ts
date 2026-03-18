import {dataUriToObjectUrl, isBase64, isUrl, safeJson5Parse} from "@agenta/shared/utils"
import {notification} from "antd"
import yaml from "js-yaml"
import JSON5 from "json5"
import Router from "next/router"
import {v4 as uuidv4} from "uuid"

import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {waitForValidURL} from "@/oss/state/url"

import {GenericObject} from "../Types"

import {isEE} from "./isEE"

export const isDemo = () => {
    return isEE()
}

export const capitalize = (s: string) => {
    if (typeof s !== "string") return ""
    return s
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
}

const URL_SAFE = /^[a-zA-Z0-9_-]+$/

export const isAppNameInputValid = (input: string) => {
    return URL_SAFE.test(input)
}

export const isVariantNameInputValid = (input: string) => {
    return URL_SAFE.test(input)
}

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))

export const snakeToCamel = (str: string) =>
    str.replace(/([-_][a-z])/g, (group) => group.toUpperCase().replace("-", "").replace("_", ""))

export const camelToSnake = (str: string) =>
    str.replace(/([A-Z])/g, (group) => `_${group.toLowerCase()}`)

export const stringToNumberInRange = (text: string, min: number, max: number) => {
    // Calculate a hash value from the input string
    let hash = 0
    for (let i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i)
    }

    // Map the hash value to the desired range
    const range = max - min + 1
    const mappedValue = ((hash % range) + range) % range

    // Add the minimum value to get the final result within the range
    const result = min + mappedValue

    return result
}

export const removeKeys = (obj: GenericObject, keys: string[]) => {
    const newObj = Object.assign({}, obj)
    for (const key of keys) {
        delete newObj[key]
    }
    return newObj
}

export const safeParse = (str: string, fallback: any = "") => {
    try {
        if (!str) return fallback
        return JSON5.parse(str)
    } catch (error) {
        return fallback
    }
}

// Re-export from @agenta/shared/utils for backward compatibility
export {dataUriToObjectUrl, isBase64, isUrl, safeJson5Parse}

export const extractChatMessages = (testcase: any) => {
    if (testcase.messages)
        return formatMessages(normalizeMessages(parseStringToJson(testcase.messages)))
    if (testcase.chat) return formatMessages(normalizeMessages(parseStringToJson(testcase.chat)))

    const filteredEntries = Object.entries(testcase).filter(([key]) => key !== "correct_answer")

    for (const [_, value] of filteredEntries) {
        const parsedValue = parseStringToJson(value)
        if (Array.isArray(parsedValue)) {
            return formatMessages(parsedValue)
        }
    }

    return []
}

const parseStringToJson = (value: any) => {
    if (typeof value === "string") {
        try {
            return JSON5.parse(value)
        } catch {
            return value
        }
    }
    return value
}

const normalizeMessages = (messages: any) => {
    if (!Array.isArray(messages) && typeof messages === "object") {
        return [messages]
    }
    return messages
}

const formatMessages = (messages: any) => {
    if (typeof messages === "object" && !Array.isArray(messages)) {
        messages = Object.values(messages)
    }

    return Array.isArray(messages)
        ? messages.map(({role, content, id}) => ({role, content, id}))
        : []
}

export function durationToStr(ms: number) {
    const duration = dayjs.duration(ms, "milliseconds")
    const days = Math.floor(duration.asDays())
    const hours = Math.floor(duration.asHours() % 24)
    const mins = Math.floor(duration.asMinutes() % 60)
    const secs = Math.floor(duration.asSeconds() % 60)

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    if (mins > 0) return `${mins}m ${secs}s`
    return `${secs}s`
}

export const generateOrRetrieveDistinctId = (): string => {
    if (typeof localStorage !== "undefined") {
        let distinctId = localStorage.getItem("posthog_distinct_id")
        if (!distinctId) {
            distinctId = uuidv4()
            localStorage.setItem("posthog_distinct_id", distinctId)
        }
        return distinctId
    } else {
        return uuidv4()
    }
}

export const redirectIfNoLLMKeys = async ({secrets: providerKeys}: {secrets: LlmProvider[]}) => {
    if (providerKeys?.length === 0 && !isDemo()) {
        notification.error({
            message: "LLM Key Missing",
            description: "Please provide at least one LLM key to access this feature.",
            duration: 5,
        })
        // Ensure project-scoped URL is ready, then redirect to project settings (secrets tab)
        const {projectURL} = await waitForValidURL({requireProject: true})
        Router.push(`${projectURL}/settings?tab=secrets`)
        return true
    }
    return false
}

export const randNum = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1) + min)

export const snakeToTitle = (str: string) => {
    return str
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
}

export const getInitials = (str: string, limit = 2) => {
    let initialText = "E"

    try {
        initialText = str
            ?.split(" ")
            .slice(0, limit)
            ?.reduce((acc, curr) => acc + (curr[0] || "")?.toUpperCase(), "")
    } catch (error) {
        console.error("Error using getInitials", error)
    }

    return initialText
}

export const getStringOrJson = (value: any) => {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

export const getYamlOrJson = (format: "JSON" | "YAML", data: any) => {
    try {
        return format === "YAML" ? yaml.dump(data) : getStringOrJson(data)
    } catch (error) {
        return getStringOrJson(data)
    }
}

export const formatVariantIdWithHash = (variantId: string) => {
    const parts = variantId.split("-")
    return `# ${parts[parts.length - 1]}`
}

export const getUsernameFromEmail = (email: string) => email.split("@")[0]

export const removeEmptyFromObjects = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj
            .map(removeEmptyFromObjects)
            .filter((item) => item && (typeof item !== "object" || Object.keys(item).length))
    }
    if (obj && typeof obj === "object") {
        return Object.entries(obj).reduce(
            (acc, [key, value]) => {
                const cleaned = removeEmptyFromObjects(value)
                if (cleaned !== null && cleaned !== undefined && cleaned !== "") {
                    acc[key] = cleaned
                }
                return acc
            },
            {} as Record<string, any>,
        )
    }
    return obj
}

export const isUuid = (id: string) => {
    // Check for full UUID format (8-4-4-4-12)
    const fullUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    // Check for just the last segment of a UUID (12 hex characters)
    const uuidSegmentRegex = /^[0-9a-f]{12}$/i

    return fullUuidRegex.test(id) || uuidSegmentRegex.test(id)
}

export const getUniquePartOfId = (id: string) => {
    const parts = id.split("-")
    return parts[parts.length - 1]
}

export const convertToStringOrJson = (value: any) => {
    return typeof value === "string" ? value : JSON.stringify(value)
}

export interface FileAttachment {
    filename: string
    data: string
    format?: string
    size?: number | string
}

export const sanitizeDataWithBlobUrls = <T = any>(
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

    const convertString = (value: any) => {
        if (typeof value === "string" && isBase64(value)) {
            return getOrCreateBlobUrl(value)
        }
        return value
    }

    const extractStringValue = (value: any): string | null => {
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
                    const nested = extractStringValue((value as any)[key])
                    if (nested) return nested
                }
            }
        }
        return null
    }

    const addImageAttachment = (
        candidate: any,
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

    const walk = (node: any): any => {
        if (Array.isArray(node)) {
            return node.map((item) => walk(item))
        }
        if (node && typeof node === "object") {
            const cloned: Record<string, any> = {}
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
                        filename: filename || "Document",
                        format,
                        size,
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
                addImageAttachment(directImage, {
                    filename:
                        directImage?.filename ??
                        directImage?.name ??
                        cloned.filename ??
                        cloned.name,
                    format: directImage?.format ?? directImage?.type,
                    size: directImage?.size,
                })
            }

            const directImageValue = cloned.image ?? cloned.imageValue
            if (directImageValue) {
                addImageAttachment(directImageValue, {
                    filename:
                        directImageValue?.filename ??
                        directImageValue?.name ??
                        cloned.filename ??
                        cloned.name,
                    format: directImageValue?.format ?? directImageValue?.type,
                })
            }

            const imageCollections = [cloned.image_urls, cloned.imageUrls, cloned.images]
            imageCollections.forEach((collection) => {
                if (!collection) return
                if (Array.isArray(collection)) {
                    collection.forEach((item: any, index: number) => {
                        addImageAttachment(item, {
                            filename:
                                item?.filename ??
                                item?.name ??
                                cloned.filename ??
                                `Image ${index + 1}`,
                            format: item?.format ?? item?.type,
                            size: item?.size,
                        })
                    })
                } else {
                    addImageAttachment(collection, {
                        filename:
                            collection?.filename ??
                            collection?.name ??
                            cloned.filename ??
                            cloned.name,
                        format: collection?.format ?? collection?.type,
                        size: collection?.size,
                    })
                }
            })

            if (cloned.type === "image_url" && cloned.url) {
                addImageAttachment(cloned.url, {
                    filename: cloned.filename ?? cloned.name,
                    format: cloned.format,
                    size: cloned.size,
                })
            }

            return cloned
        }
        return convertString(node)
    }

    return {data: walk(input), blobUrls, fileAttachments, imageAttachments}
}
