import {hashResponse} from "@/oss/components/Playground/assets/hash"
import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"

/**
 * Build an Enhanced assistant message from a result payload using a schema when available.
 * Falls back to a minimal Enhanced shape with readable text when needed.
 */
export function buildAssistantMessage(messageSchema: any | undefined, testResult: any) {
    if (messageSchema) {
        try {
            if (testResult?.error) {
                const tree = testResult?.metadata?.rawError?.detail?.tree
                const trace = tree?.nodes?.[0]
                const messageStr = trace?.status?.message ?? String(testResult.error)
                return createMessageFromSchema(messageSchema, {
                    role: "Error",
                    content: messageStr,
                })
            }

            const raw = (testResult as any)?.response?.data
            const inner = raw && typeof raw === "object" ? ((raw as any).data ?? raw) : raw
            const content =
                inner && typeof inner === "object"
                    ? ((inner as any).content ?? (inner as any).data)
                    : undefined

            let finalText: string | undefined
            if (typeof content === "string") {
                finalText = content
            } else if (Array.isArray(content)) {
                try {
                    const texts = content
                        .map((p: any) =>
                            p?.type === "text" ? (p?.text?.value ?? p?.text ?? "") : undefined,
                        )
                        .filter(Boolean)
                    finalText = texts.join("\n\n")
                } catch {
                    finalText = undefined
                }
            }
            if (finalText) {
                return createMessageFromSchema(messageSchema, {
                    role: "assistant",
                    content: {value: finalText},
                })
            }
            return createMessageFromSchema(messageSchema, inner)
        } catch {
            // fall through to minimal
        }
    }

    // Minimal Enhanced fallback
    const raw = (testResult as any)?.response?.data ?? (testResult as any)?.error
    const contentValue =
        typeof raw === "string"
            ? raw
            : (() => {
                  try {
                      return JSON.stringify(raw)
                  } catch {
                      return String(raw ?? "")
                  }
              })()
    return {
        __id: generateId(),
        role: {
            value: testResult?.error ? "Error" : "assistant",
            __id: generateId(),
        },
        content: {value: contentValue, __id: generateId()},
    }
}

/**
 * Build stable completion response text by normalizing error shape and hashing.
 * This mirrors the UI's expectation of a text node for completion results.
 */
export function buildCompletionResponseText(testResult: any): string {
    let normalized = testResult
    try {
        if (testResult?.error) {
            const tree = testResult?.metadata?.rawError?.detail?.tree
            const trace = tree?.nodes?.[0]
            const messageStr = trace?.status?.message ?? String(testResult.error)
            normalized = {
                response: {data: messageStr, tree},
                error: messageStr,
                metadata: testResult?.metadata,
            }
        }
    } catch {
        // keep original
    }
    return hashResponse(normalized)
}
