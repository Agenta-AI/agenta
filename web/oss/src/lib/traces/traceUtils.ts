import {TraceData, TraceTree} from "@agenta/oss/src/lib/hooks/useEvaluationRunScenarioSteps/types"

import {uuidToTraceId} from "@/oss/lib/traces/helpers"

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
    "attributes.ag.data": "data",
    // Add more mappings here if needed
}

export function readInvocationResponse({
    scenarioData,
    stepKey,
    path,
    optimisticResult,
    forceTrace,
    scenarioId,
    evalType,
}: {
    scenarioData: any
    stepKey: string
    path?: string
    optimisticResult?: any
    forceTrace?: TraceTree
    scenarioId?: string
    evalType?: "auto" | "online" | "human"
}): {
    trace?: any
    value?: any
    rawValue?: any
    testsetId?: string
    testcaseId?: string
    resolvedPath?: string
} {
    if (!scenarioData) return {}

    const invocationSteps: any[] = Array.isArray(scenarioData.invocationSteps)
        ? scenarioData.invocationSteps
        : []
    const stepByKey = stepKey ? invocationSteps.find((s: any) => s?.stepKey === stepKey) : undefined
    const stepByScenario =
        !stepByKey && scenarioId
            ? invocationSteps.find((s: any) => s?.scenarioId === scenarioId)
            : undefined
    const invocationStep = stepByKey ?? stepByScenario ?? invocationSteps[0]
    const effectiveStepKey = invocationStep?.stepKey ?? stepKey

    // --- PATH RESOLUTION LOGIC ---
    const candidatePaths: string[] = []
    const registerPath = (targetPath?: string) => {
        if (!targetPath || typeof targetPath !== "string") return
        const trimmed = targetPath.trim()
        if (!trimmed) return
        candidatePaths.push(trimmed)
        const canonical = INVOCATION_OUTPUT_KEY_MAP[trimmed]
        if (canonical) {
            candidatePaths.push(canonical)
        }
        if (trimmed === "attributes.ag.data.outputs") {
            candidatePaths.push("attributes.ag.data.outputs.outputs")
            candidatePaths.push("data.outputs")
            candidatePaths.push("outputs")
        } else if (trimmed.startsWith("attributes.ag.data.outputs.")) {
            const suffix = trimmed.slice("attributes.ag.data.outputs.".length)
            if (suffix) {
                candidatePaths.push(`data.outputs.${suffix}`)
                candidatePaths.push(`outputs.${suffix}`)
            }
        } else if (trimmed.startsWith("data.outputs.")) {
            const suffix = trimmed.slice("data.outputs.".length)
            if (suffix) {
                candidatePaths.push(`outputs.${suffix}`)
            }
        }
    }

    if (path) {
        registerPath(path)
    }

    if (scenarioData.mappings && Array.isArray(scenarioData.mappings) && effectiveStepKey) {
        const mapEntry = scenarioData.mappings.find((m: any) => m.step?.key === effectiveStepKey)
        if (mapEntry?.step?.path) {
            registerPath(mapEntry.step.path)
        }
    }

    if (!candidatePaths.length) {
        registerPath("attributes.ag.data.outputs")
    }

    const resolvedCandidates = Array.from(
        new Set(candidatePaths.filter((p): p is string => typeof p === "string" && p.length)),
    )
    const resolvedPath = resolvedCandidates[0]
    // --- END PATH RESOLUTION LOGIC ---

    // --- MAPPING LOGIC FOR TESTSET/TESTCASE INFERENCE ---
    let testsetId: string | undefined = undefined
    let testcaseId: string | undefined = undefined
    if (scenarioData.mappings && Array.isArray(scenarioData.mappings) && effectiveStepKey) {
        const mapping = scenarioData.mappings.find(
            (m: any) =>
                m.invocationStep?.stepKey === effectiveStepKey ||
                m.step?.stepKey === effectiveStepKey,
        )
        if (mapping && mapping.inputStep?.stepKey) {
            const inputStep = scenarioData.inputSteps?.find(
                (s: any) => s.stepKey === mapping.inputStep.stepKey,
            )
            if (inputStep) {
                testsetId = inputStep.testsetId
                testcaseId = inputStep.testcaseId
            }
        }
    }
    // -----------------------------------------------------

    // Access trace directly attached to the invocation step (set during enrichment)
    const invocationTrace = forceTrace || invocationStep?.trace
    const candidateNodes: any[] = []
    if (invocationTrace) {
        if (Array.isArray(invocationTrace?.nodes)) {
            candidateNodes.push(...invocationTrace.nodes)
        }
        if (Array.isArray(invocationTrace?.tree?.nodes)) {
            candidateNodes.push(...invocationTrace.tree.nodes)
        }
        if (invocationTrace?.tree) {
            candidateNodes.push(invocationTrace.tree)
        }
        candidateNodes.push(invocationTrace)
    }
    const primaryTraceNode =
        Array.isArray(candidateNodes) && candidateNodes.length ? candidateNodes[0] : undefined
    const resolvedTrace = invocationTrace ?? primaryTraceNode

    // First priority: optimistic result override (e.g., UI enqueue)
    let rawValue = optimisticResult

    if (rawValue === undefined && resolvedPath) {
        rawValue = resolvePath(primaryTraceNode, resolvedPath)
        if (rawValue === undefined) {
            for (const node of candidateNodes.slice(1)) {
                rawValue = resolvePath(node, resolvedPath)
                if (rawValue !== undefined) break
            }
        }
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
    return {
        trace: resolvedTrace,
        value,
        rawValue,
        testsetId,
        testcaseId,
        resolvedPath,
    }
}
