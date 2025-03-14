import {
    ConfigMetadata,
    OpenAPISpec,
} from "@/oss/components/NewPlayground/assets/utilities/genericTransformer/types"
import {GenerationChatRow, GenerationInputRow} from "@/oss/components/NewPlayground/state/types"

import {parseValidationError} from "../../../assets/utilities/errors"
import {
    constructPlaygroundTestUrl,
    transformToRequestBody,
} from "../../../assets/utilities/transformer/reverseTransformer"
import {EnhancedVariant} from "../../../assets/utilities/transformer/types"

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
}) {
    const {
        variant,
        rowId,
        uri,
        inputRow,
        messageId,
        messageRow,
        allMetadata,
        headers,
        projectId,
        appId,
        chatHistory,
        spec,
    } = payload
    const requestBody = transformToRequestBody({
        variant,
        inputRow,
        messageRow,
        allMetadata,
        chatHistory,
        spec,
        routePath: uri?.routePath,
    })
    let result

    try {
        const response = await fetch(
            `${constructPlaygroundTestUrl(uri, "/test", true)}${headers.Authorization ? `?project_id=${projectId}&application_id=${appId}` : `?application_id=${appId}`}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "ngrok-skip-browser-warning": "1",
                    ...headers,
                },
                body: JSON.stringify(requestBody),
            },
        )

        const data = await response.json()
        if (!response.ok) {
            const errorMessage = parseValidationError(data)
            result = {
                response: undefined,
                error: errorMessage,
                metadata: {
                    timestamp: new Date().toISOString(),
                    statusCode: response.status,
                    rawError: data,
                },
            }
        } else {
            result = {
                response: data,
                metadata: {
                    timestamp: new Date().toISOString(),
                    statusCode: response.status,
                },
            }
        }
    } catch (error) {
        console.error("Error running variant input row:", error)
        result = {
            response: undefined,
            error: error instanceof Error ? error.message : "Unknown error occurred",
            metadata: {
                timestamp: new Date().toISOString(),
                type: "network_error",
            },
        }
    } finally {
        postMessage({
            type: "runVariantInputRowResult",
            payload: {
                variant,
                rowId,
                result,
                messageId,
            },
        })
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
        } else {
            postMessage({
                type: "error",
                payload: "Unknown message",
            })
        }
    },
)
