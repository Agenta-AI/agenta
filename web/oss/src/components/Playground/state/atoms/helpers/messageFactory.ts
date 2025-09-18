import {hashResponse} from "@/oss/components/Playground/assets/hash"

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
