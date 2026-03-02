/**
 * Utility functions for SingleScenarioViewerPOC
 * These are pure functions that don't depend on React state/props
 */

// Get step type from various possible field names
export const getStepType = (step: any): string =>
    ((step?.type ?? step?.kind ?? step?.stepType ?? step?.step_type ?? "") as string).toLowerCase()

// Get step key from various possible field names
export const getStepKey = (step: any): string =>
    String(step?.stepKey || step?.step_key || step?.key || "")

// Classify a step based on its data structure (fallback when runIndex is not available)
export const classifyStep = (step: any): "input" | "invocation" | "annotation" | null => {
    const t = getStepType(step)
    if (t === "input" || t === "invocation" || t === "annotation") return t

    if (
        step?.inputs ||
        step?.input ||
        step?.groundTruth ||
        step?.testcase ||
        step?.data?.inputs ||
        step?.data?.input ||
        step?.payload?.inputs ||
        step?.payload?.input
    ) {
        return "input"
    }

    if (
        step?.annotation ||
        step?.annotations ||
        step?.data?.annotations ||
        step?.payload?.annotations
    ) {
        return "annotation"
    }

    if (
        step?.traceId ||
        step?.invocationParameters ||
        step?.outputs ||
        step?.output ||
        step?.response ||
        step?.result ||
        step?.data?.outputs ||
        step?.data?.output ||
        step?.payload?.outputs ||
        step?.payload?.output
    ) {
        return "invocation"
    }

    const key = getStepKey(step)
    if (key.includes("human") || key.includes("annotation")) return "annotation"
    if (key) return "invocation"

    return null
}

// Extract inputs from a step
export const extractInputs = (step: any) =>
    step?.inputs ??
    step?.input ??
    step?.groundTruth ??
    step?.testcase ??
    step?.data?.inputs ??
    step?.data?.input ??
    step?.payload?.inputs ??
    step?.payload?.input ??
    null

// Extract outputs from a step
export const extractOutputs = (step: any) =>
    step?.outputs ??
    step?.output ??
    step?.response ??
    step?.result ??
    step?.data?.outputs ??
    step?.data?.output ??
    step?.payload?.outputs ??
    step?.payload?.output ??
    null

// Get trace tree from a step
export const getTraceTree = (step: any, fallbackTrace?: any) => {
    const candidate =
        step?.trace ??
        step?.traceData ??
        step?.trace_data ??
        step?.data?.trace ??
        step?.data?.outputs?.trace ??
        step?.response?.tree ??
        step?.result?.trace ??
        step?.result?.response?.tree ??
        fallbackTrace ??
        null
    if (!candidate) return null
    if (candidate?.nodes) return candidate
    return {nodes: [candidate]}
}

// Get trace ID from a step
export const getTraceIdForStep = (step: any, fallbackTrace?: any): string | null => {
    const directCandidates = [
        step?.traceId,
        step?.trace_id,
        step?.trace?.trace_id,
        step?.trace?.id,
        step?.traceData?.trace_id,
        step?.trace_data?.trace_id,
        step?.data?.trace_id,
        step?.data?.trace?.id,
        step?.data?.trace_id,
        step?.response?.trace_id,
        step?.result?.trace_id,
        step?.result?.response?.trace_id,
        fallbackTrace?.tree?.id,
    ].filter(Boolean)

    if (directCandidates.length) {
        return String(directCandidates[0])
    }

    const tree = getTraceTree(step, fallbackTrace)
    if (!tree) return null

    const treeId =
        tree?.tree?.id ??
        (typeof tree?.tree === "string" ? tree.tree : null) ??
        (tree as any)?.id ??
        null
    if (treeId) return String(treeId)

    const firstNode = (() => {
        if (Array.isArray((tree as any).nodes)) {
            return (tree as any).nodes[0]
        }
        const nodeValues = Object.values((tree as any).nodes ?? {})
        if (nodeValues.length) {
            const candidate = nodeValues[0] as any
            if (Array.isArray(candidate)) return candidate[0]
            return candidate
        }
        return null
    })()

    const nodeTraceId =
        firstNode?.trace_id ??
        firstNode?.traceId ??
        firstNode?.node?.trace_id ??
        firstNode?.node?.id ??
        null

    return nodeTraceId ? String(nodeTraceId) : null
}

// Filter steps by key set with fallback logic
export const filterStepsByKeySet = (
    steps: any[],
    keySet: Set<string>,
    fallbackFn: (step: any, key: string) => boolean,
): any[] => {
    return steps.filter((step) => {
        const key = getStepKey(step)
        if (keySet.size > 0) {
            return keySet.has(key)
        }
        return fallbackFn(step, key)
    })
}

// Get scenario status color
export const getScenarioStatusColor = (status?: string): string => {
    const normalized = status?.toLowerCase?.()
    if (!normalized) return "default"
    if (["success", "succeeded", "completed"].includes(normalized)) return "success"
    if (["failed", "error"].includes(normalized)) return "error"
    if (["running", "in_progress", "pending"].includes(normalized)) return "processing"
    return "default"
}
