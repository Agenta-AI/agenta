import {transformToRequestBody} from "../../../assets/utilities/transformer/reverseTransformer"
import {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {parseValidationError} from "../../../assets/utilities/errors"
import {ConfigMetadata} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"

async function runVariantInputRow(payload: {
    variant: EnhancedVariant
    allMetadata: Record<string, ConfigMetadata>
    inputRow: EnhancedVariant["inputs"]["value"][number]
    messageRow?: EnhancedVariant["messages"]["value"][number]
    rowId: string
    appId: string
    uri: string
    headers: Record<string, string>
    projectId: string
    messageId?: string
    chatHistory?: any[]
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
    } = payload
    const requestBody = transformToRequestBody({
        variant,
        inputRow,
        messageRow,
        allMetadata,
        chatHistory,
    })
    let result

    try {
        const response = await fetch(
            `${uri}/generate${headers.Authorization ? `?project_id=${projectId}&application_id=${appId}` : `?application_id=${appId}`}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
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
