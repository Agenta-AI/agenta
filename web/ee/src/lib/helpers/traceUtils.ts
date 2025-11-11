import {uuidToTraceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"

import {TraceData, TraceTree} from "../hooks/useEvaluationRunScenarioSteps/types"

export function findTraceForStep(traces: any[] | undefined, traceId?: string): any | undefined {
    if (!traces?.length || !traceId) return undefined
    const noDash = uuidToTraceId(traceId)

    return traces.find((t) => {
        // Case 1: wrapper with trees array (new shape)
        if (t?.trees?.length) {
            const firstTree = t.trees[0]
            if (firstTree?.tree?.id === traceId) return true
            if (firstTree?.nodes?.[0]?.trace_id === noDash) return true
        }
        // Case 2: flat shape { tree, nodes }
        if (t?.tree?.id === traceId) return true
        if (t?.nodes?.[0]?.trace_id === noDash) return true
        return false
    })
}

// generic safe path resolver
export function resolvePath(obj: any, path: string): any {
    const parts = path.split(".")
    let current: any = obj
    for (let i = 0; i < parts.length && current !== undefined; i++) {
        const key = parts[i]
        if (key in current) {
            current = current[key]
            continue
        }
        // if the exact key not found, try joining the remaining parts as a whole key (to support dots inside actual key names)
        const remainder = parts.slice(i).join(".")
        if (remainder in current) {
            current = current[remainder]
            return current
        }
        return undefined
    }
    return current
}

// Unified helper to obtain trace and response value for a specific invocation step
// Manual mapping for legacy/compatibility keys to canonical keys
const INVOCATION_OUTPUT_KEY_MAP: Record<string, string> = {
    "attributes.ag.data.outputs": "data.outputs",
    // Add more mappings here if needed
}

export function readInvocationResponse({
    scenarioData,
    stepKey,
    path,
    optimisticResult,
    forceTrace,
}: {
    scenarioData: any
    stepKey: string
    path?: string
    optimisticResult?: any
    forceTrace?: TraceTree
}): {trace?: any; value?: any; rawValue?: any; testsetId?: string; testcaseId?: string} {
    if (!scenarioData) return {}

    // --- PATH RESOLUTION LOGIC ---
    let resolvedPath: string | undefined = undefined
    if (path) {
        resolvedPath = path
    } else if (scenarioData.mappings && Array.isArray(scenarioData.mappings)) {
        const mapEntry = scenarioData.mappings.find((m: any) => m.step?.key === stepKey)
        if (mapEntry && mapEntry.step?.path) {
            resolvedPath = mapEntry.step.path
        }
    }
    // After resolving, apply legacy/custom mapping if needed
    if (resolvedPath && INVOCATION_OUTPUT_KEY_MAP[resolvedPath]) {
        resolvedPath = INVOCATION_OUTPUT_KEY_MAP[resolvedPath]
    }
    // --- END PATH RESOLUTION LOGIC ---

    if (!scenarioData) return {}

    // find invocation step
    const invocationStep = scenarioData.invocationSteps?.find((s: any) => s.key === stepKey)
    if (!invocationStep) return {}

    // --- MAPPING LOGIC FOR TESTSET/TESTCASE INFERENCE ---
    let testsetId: string | undefined = undefined
    let testcaseId: string | undefined = undefined
    if (scenarioData.mappings && Array.isArray(scenarioData.mappings)) {
        const mapping = scenarioData.mappings.find((m: any) => m.invocationStep?.key === stepKey)
        if (mapping && mapping.inputStep?.key) {
            const inputStep = scenarioData.inputSteps?.find(
                (s: any) => s.key === mapping.inputStep.key,
            )
            if (inputStep) {
                testsetId = inputStep.testsetId
                testcaseId = inputStep.testcaseId
            }
        }
    }
    // -----------------------------------------------------

    // Access trace directly attached to the invocation step (set during enrichment)
    const trace = (forceTrace || invocationStep.trace?.nodes?.[0]) ?? undefined

    // First priority: optimistic result override (e.g., UI enqueue)
    let rawValue = optimisticResult
    if (rawValue === undefined && resolvedPath) {
        rawValue = resolvePath(trace, resolvedPath)
    }

    // Convert raw value to displayable string where possible
    let value: any = rawValue
    if (
        typeof rawValue === "string" ||
        typeof rawValue === "number" ||
        typeof rawValue === "boolean"
    ) {
        value = String(rawValue)
    } else if (rawValue && typeof rawValue === "object") {
        if (typeof (rawValue as any).content === "string") {
            value = (rawValue as any).content
        } else {
            try {
                value = JSON.stringify(rawValue, null, 2)
            } catch {
                value = String(rawValue as any)
            }
        }
    }
    return {trace, value, rawValue, testsetId, testcaseId}
}
