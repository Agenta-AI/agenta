import {transformToRequestBody} from "../../../assets/utilities/transformer/reverseTransformer"
import {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {parseValidationError} from "../../../assets/utilities/errors"

async function runVariantInputRow(payload: {
    variant: EnhancedVariant
    rowId: string
    appId: string
    uri: string
}) {
    const {variant, rowId, uri} = payload
    const requestBody = transformToRequestBody(variant, rowId)
    let result

    try {
        const response = await fetch(`${uri}/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        })

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
