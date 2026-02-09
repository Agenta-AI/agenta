import {ConfigMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {constructPlaygroundTestUrl} from "@/oss/lib/shared/variant/stringUtils"
import {OpenAPISpec} from "@/oss/lib/shared/variant/types/openapi"
import {stripAgentaMetadataDeep, stripEnhancedWrappers} from "@/oss/lib/shared/variant/valueHelpers"

import {transformToRequestBody} from "../../../../../lib/shared/variant/transformer/transformToRequestBody"
import {EnhancedVariant} from "../../../../../lib/shared/variant/transformer/types"
import {parseValidationError} from "../../../assets/utilities/errors"

// Define types locally since they are not exported
type GenerationChatRow = any
type GenerationInputRow = any

// Track in-flight requests so we can cancel them by runId
const abortControllers = new Map<string, AbortController>()

const MODELS = ["gemini"]

const extractPromptModel = (variant: EnhancedVariant, requestBody: Record<string, any>) => {
    const candidates = [
        requestBody?.ag_config?.prompt,
        Array.isArray(requestBody?.ag_config?.prompts)
            ? requestBody?.ag_config?.prompts?.[0]
            : undefined,
        variant?.parameters?.ag_config?.prompt,
        variant?.parameters?.prompt,
        (variant?.parameters as any)?.agConfig?.prompt,
    ]

    for (const prompt of candidates) {
        if (!prompt) continue
        const llmCfg = (prompt as any).llm_config || (prompt as any).llmConfig
        if (llmCfg?.model) {
            return llmCfg.model as string
        }
    }
    return undefined
}

const isFileReference = (value: string) => {
    if (!value) return false
    if (/^https?:\/\//i.test(value)) return true
    return value.startsWith("file_") || value.startsWith("file-")
}

/**
 * Normalize file content parts in messages to match the provider-expected format.
 *
 * Mirrors the reverseTransformer logic (reverseTransformer.ts:84-92):
 * - If file_id contains a data URL (base64), move it to file_data and remove file_id
 * - Remove empty string values
 * - Deduplicate aliased fields (name/filename → filename, mime_type/format → format)
 */
const normalizeFileContentParts = (messages: any[]) => {
    for (const msg of messages) {
        if (!msg || !Array.isArray(msg.content)) continue
        for (const part of msg.content) {
            if (!part || part.type !== "file" || !part.file) continue
            const file = part.file

            // Move data URL from file_id to file_data (matches reverseTransformer)
            if (typeof file.file_id === "string" && file.file_id.startsWith("data:")) {
                file.file_data = file.file_id
                delete file.file_id
            }

            // Deduplicate name → filename (prefer filename if both exist)
            if ("name" in file && "filename" in file) {
                file.filename = file.filename || file.name
                delete file.name
            } else if ("name" in file) {
                file.filename = file.name
                delete file.name
            }

            // Deduplicate mime_type → format (prefer format if both exist)
            if ("mime_type" in file && "format" in file) {
                file.format = file.format || file.mime_type
                delete file.mime_type
            } else if ("mime_type" in file) {
                file.format = file.mime_type
                delete file.mime_type
            }

            // Remove empty string values
            for (const key of Object.keys(file)) {
                if (file[key] === "") delete file[key]
            }
        }
    }
}

const stripFileMetadataForUrlAttachments = (messages: any[]) => {
    messages.forEach((message) => {
        if (!message || !Array.isArray(message.content)) return
        message.content.forEach((part: any) => {
            if (!part || part.type !== "file") return
            const fileNode = part.file || {}
            const fileId = fileNode.file_id || fileNode.fileId
            if (typeof fileId !== "string" || !isFileReference(fileId)) return
            delete fileNode.filename
            delete fileNode.format
        })
    })
}

const applyModelAttachmentRules = (variant: EnhancedVariant, requestBody: Record<string, any>) => {
    if (!requestBody || typeof requestBody !== "object") return
    if (Array.isArray(requestBody.messages)) {
        const modelName = extractPromptModel(variant, requestBody)
        if (modelName && MODELS.some((allowed) => modelName.toLowerCase().includes(allowed))) {
            return
        }
        stripFileMetadataForUrlAttachments(requestBody.messages)
    }
}

// Simple p-limit implementation to avoid adding dependencies
const pLimit = (concurrency: number) => {
    const queue: (() => Promise<void>)[] = []
    let activeCount = 0

    const next = () => {
        activeCount--
        if (queue.length > 0) {
            queue.shift()!()
        }
    }

    const run = async <T>(
        fn: () => Promise<T>,
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: any) => void,
    ) => {
        activeCount++
        const result = (async () => fn())()
        try {
            const res = await result
            resolve(res)
        } catch (err) {
            reject(err)
        } finally {
            next()
        }
    }

    const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const task = () => run(fn, resolve, reject)

            if (activeCount < concurrency) {
                task()
            } else {
                queue.push(task)
            }
        })
    }

    return enqueue
}

// Global limiter instance to share concurrency limit across all "runVariantInputRow" calls
// This ensures that even if 20 rows trigger this function simultaneously, total concurrent fetches won't exceed 6.
const limit = pLimit(6)

async function runVariantInputRow(payload: {
    variant: EnhancedVariant
    allMetadata: Record<string, ConfigMetadata>
    inputRow: GenerationInputRow
    messageRow?: GenerationChatRow
    rowId: string
    appId: string
    uri: {
        runtimePrefix: string
        routePath?: string
        status?: boolean
    }
    headers: Record<string, string>
    projectId: string
    messageId?: string
    chatHistory?: any[]
    spec: OpenAPISpec
    runId: string
    prompts?: any[]
    variables?: string[]
    variableValues?: Record<string, string>
    revisionId?: string
    variantId?: string
    isChat?: boolean
    isCustom?: boolean
    appType?: string
    repetitions?: number
}) {
    const {
        variant,
        allMetadata,
        inputRow,
        messageRow,
        rowId, // Ensure rowId is destructured
        appId,
        uri,
        headers,
        projectId,
        chatHistory,
        spec,
        runId,
        prompts,
        variables,
        variableValues,
        revisionId,
        variantId,
        messageId, // Ensure messageId is destructured
        isChat,
        isCustom,
        appType,
        repetitions = 1,
    } = payload

    try {
        const requestBody = stripAgentaMetadataDeep(
            transformToRequestBody({
                variant,
                inputRow,
                messageRow,
                allMetadata,
                chatHistory,
                spec,
                routePath: uri?.routePath,
                prompts,
                variables,
                variableValues,
                revisionId,
                isChat,
                isCustom,
                appType,
            }),
        )

        // Strip any remaining enhanced value wrappers (__id, __metadata, {value: X})
        // from messages — fallback content parts may bypass extractValueByMetadata
        if (Array.isArray(requestBody.messages)) {
            requestBody.messages = stripEnhancedWrappers(requestBody.messages) as any[]
            // Normalize file content parts: mirrors reverseTransformer logic for
            // file_id→file_data conversion, field deduplication, and empty value removal.
            normalizeFileContentParts(requestBody.messages)
        }

        // Ensure we don't send repetitions to the backend as we handle it here
        if ("repetitions" in requestBody) {
            delete requestBody.repetitions
        }

        applyModelAttachmentRules(variant, requestBody)

        // Create an AbortController for this run to support cancellation
        // We reuse the same controller for all repetition requests
        const controller = new AbortController()
        abortControllers.set(runId, controller)

        const baseUrl = constructPlaygroundTestUrl(uri, "/test", true)
        const fullUrl = baseUrl
        const search = new URLSearchParams()
        search.set("application_id", appId)
        if (headers.Authorization && projectId) {
            search.set("project_id", projectId)
        }
        const queryParams = `?${search.toString()}`

        // Define the task for a single request
        const executeRequest = async () => {
            try {
                const response = await fetch(`${fullUrl}${queryParams}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "ngrok-skip-browser-warning": "1",
                        ...headers,
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal,
                })
                let data: any = null
                let responseText = ""
                try {
                    responseText = await response.text()
                    if (responseText) {
                        try {
                            data = JSON.parse(responseText)
                        } catch {
                            data = responseText
                        }
                    }
                } catch {
                    data = null
                }

                if (!response.ok) {
                    let errorMessage: string
                    if (response.status === 429) {
                        const retryAfter = response.headers.get("Retry-After")
                        const detail =
                            typeof (data as any)?.detail === "string"
                                ? (data as any).detail
                                : typeof data === "string"
                                  ? data
                                  : "API Rate limit exceeded. Please try again later or upgrade your plan."
                        errorMessage = retryAfter
                            ? `${detail} Retry after ${retryAfter}s.`
                            : `${detail} Please try again later.`
                    } else {
                        errorMessage = parseValidationError(data) || "An unknown error occurred"
                    }
                    return {
                        response: undefined,
                        error: errorMessage,
                        metadata: {
                            timestamp: new Date().toISOString(),
                            statusCode: response.status,
                            retryAfter: response.headers.get("Retry-After") || undefined,
                            rawError: data,
                        },
                    }
                }

                return {
                    response: data,
                    metadata: {
                        timestamp: new Date().toISOString(),
                        statusCode: response.status,
                    },
                }
            } catch (error: any) {
                if (error.name === "AbortError") throw error // Let Promise.all catch aborts

                return {
                    response: undefined,
                    error: error.message || "Unknown error",
                    metadata: {
                        timestamp: new Date().toISOString(),
                        type: "network_error",
                    },
                }
            }
        }

        // Queue tasks
        const tasks = Array.from({length: repetitions}).map(() => limit(executeRequest))
        const results = await Promise.all(tasks)

        // Post results
        postMessage({
            type: "runVariantInputRowResult", // Use explicit type matching the listener expectations
            payload: {
                variant,
                variantId: variantId || revisionId || (variant as any)?.id,
                revisionId,
                rowId,
                result: results, // Array of results
                messageId,
                runId,
            },
        })
    } catch (error: any) {
        if (error.name === "AbortError") {
            // Cancelled, do nothing
            return
        }

        // If the entire batch fails (e.g. body construction error), send error
        postMessage({
            type: "runVariantInputRowResult",
            payload: {
                variant,
                variantId: variantId || revisionId || (variant as any)?.id,
                revisionId,
                rowId,
                result: {
                    error: error.message || String(error),
                    metadata: {
                        timestamp: new Date().toISOString(),
                        type: "execution_error",
                    },
                },
                messageId,
                runId,
            },
        })
    } finally {
        abortControllers.delete(runId)
    }
}
addEventListener(
    "message",
    (
        event: MessageEvent<{
            type: string
            payload: any
        }>,
    ) => {
        if (event.data.type === "ping") {
            postMessage("pong")
        } else if (event.data.type === "runVariantInputRow") {
            runVariantInputRow(event.data.payload)
        } else if (event.data.type === "cancelRun") {
            const {runId} = event.data.payload || {}
            const controller = runId ? abortControllers.get(runId) : undefined
            if (controller) {
                controller.abort()
                abortControllers.delete(runId)
            }
        } else {
            postMessage({
                type: "error",
                payload: "Unknown message",
            })
        }
    },
)
