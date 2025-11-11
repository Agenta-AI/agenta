/*
 * Worker-friendly clone of `hooks/useEvaluationRunData/assets/enrichment`.
 * It removes React / cookie / axios dependencies and relies solely on data
 * passed from the main thread via the worker context.
 */

import {uuidToTraceId, uuidToSpanId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import type {RunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import type {
    IStepResponse,
    StepResponseStep,
    UseEvaluationRunScenarioStepsFetcherResult,
} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import type {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {constructPlaygroundTestUrl} from "@/oss/lib/shared/variant/stringUtils"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {PreviewTestset, WorkspaceMember} from "@/oss/lib/Types"

function collectTraceIds({steps, invocationKeys}: {steps: any[]; invocationKeys: Set<string>}) {
    const traceIds: string[] = []
    steps.forEach((st: any) => {
        if (invocationKeys.has(st.stepKey) && st.traceId) traceIds.push(st.traceId)
    })
    return traceIds
}

function buildAnnotationLinks({
    annotationSteps,
    uuidToTraceId: toTrace,
    uuidToSpanId: toSpan,
}: {
    annotationSteps: any[]
    uuidToTraceId: (uuid: string) => string | undefined
    uuidToSpanId: (uuid: string) => string | undefined
}) {
    return annotationSteps
        .filter((s) => s.traceId)
        .map((s) => ({trace_id: toTrace(s.traceId) || s.traceId, span_id: toSpan(s.traceId)}))
}

export function buildAnnotationMap({
    rawAnnotations,
    members,
}: {
    rawAnnotations: any[]
    members?: any[]
}): Map<string, AnnotationDto> {
    const map = new Map<string, AnnotationDto>()
    if (!rawAnnotations?.length) return map
    const normalized = rawAnnotations.map((ann: any) =>
        transformApiData({data: ann, members: members || []}),
    )
    normalized.forEach((a: any) => {
        if (a?.trace_id) map.set(a.trace_id, a)
    })
    return map
}

/** Simple dot-path resolver ("a.b.c"). Supports literal keys that contain dots. */
export function resolvePath(obj: any, path: string): any {
    if (!obj || typeof obj !== "object" || !path) return undefined

    const parts = path.split(".")
    let current: any = obj

    for (let i = 0; i < parts.length; i++) {
        if (current === undefined || current === null) return undefined

        const part = parts[i]

        if (Object.prototype.hasOwnProperty.call(current, part)) {
            current = current[part]
            continue
        }

        let combined = part
        let found = false

        for (let j = i + 1; j < parts.length; j++) {
            combined += `.${parts[j]}`
            if (Object.prototype.hasOwnProperty.call(current, combined)) {
                current = current[combined]
                i = j
                found = true
                break
            }
        }

        if (!found) return undefined
    }

    return current
}

export function computeInputsAndGroundTruth({
    testcase,
    mappings,
    inputKey,
    inputParamNames,
}: {
    testcase: any
    mappings: any[]
    inputKey: string
    inputParamNames: string[]
}) {
    const isRevisionKnown = Array.isArray(inputParamNames) && inputParamNames.length > 0

    // Heuristic fallback names for ground truth columns when revision input params are unknown
    const GT_NAMES = new Set(["correct_answer", "expected_output", "ground_truth", "label"])

    const inputMappings = (mappings ?? []).filter((m) => {
        if (m.step.key !== inputKey) return false
        const name = m.column?.name
        if (isRevisionKnown) return inputParamNames.includes(name)
        // Fallback: treat testset columns not matching GT names as inputs
        return m.column?.kind === "testset" && !GT_NAMES.has(name)
    })

    const groundTruthMappings = (mappings ?? []).filter((m) => {
        if (m.step.key !== inputKey) return false
        const name = m.column?.name
        if (isRevisionKnown) return m.column?.kind === "testset" && !inputParamNames.includes(name)
        // Fallback: treat well-known GT names as ground truth
        return m.column?.kind === "testset" && GT_NAMES.has(name)
    })

    const objFor = (filtered: any[]) =>
        filtered.reduce((acc: any, m: any) => {
            let val = resolvePath(testcase, m.step.path)
            if (val === undefined && m.step.path.startsWith("data.")) {
                val = resolvePath(testcase, m.step.path.slice(5))
            }
            if (val !== undefined) acc[m.column?.name || m.name] = val
            return acc
        }, {})

    let inputs = objFor(inputMappings)
    let groundTruth = objFor(groundTruthMappings)

    // Fallback: if no mappings for inputs, derive directly from testcase.data keys
    if (!Object.keys(inputs).length && testcase && typeof testcase === "object") {
        const dataObj = (testcase as any).data || {}
        if (dataObj && typeof dataObj === "object") {
            Object.keys(dataObj).forEach((k) => {
                if (!GT_NAMES.has(k) && k !== "messages") {
                    inputs[k] = dataObj[k]
                }
            })
            // Ground truth fallback: pick a known GT field if present
            if (!Object.keys(groundTruth).length) {
                for (const name of Array.from(GT_NAMES)) {
                    if (name in dataObj) {
                        ;(groundTruth as any)[name] = dataObj[name]
                        break
                    }
                }
            }
        }
    }

    return {inputs, groundTruth}
}

export function identifyScenarioSteps({
    steps,
    runIndex,
    evaluators,
}: {
    steps: StepResponseStep[]
    runIndex?: {inputKeys: Set<string>; invocationKeys: Set<string>; steps: Record<string, any>}
    evaluators: EvaluatorDto[]
}) {
    const inputSteps = steps.filter((s) => runIndex?.inputKeys?.has(s.stepKey))

    const invocationKeys = runIndex?.invocationKeys ?? new Set<string>()
    const invocationSteps = steps.filter((s) => invocationKeys.has(s.stepKey))

    const evaluatorIds = new Set<string>(
        (evaluators || []).map((e) => (typeof e.id === "string" ? e.id : "")).filter(Boolean),
    )
    const evaluatorSlugs = new Set<string>(
        (evaluators || []).map((e) => (typeof e.slug === "string" ? e.slug : "")).filter(Boolean),
    )

    const annotationSteps = steps.filter((step) => {
        const meta = runIndex?.steps?.[step.stepKey]
        const refEvaluator = meta?.refs?.evaluator ?? (step as any)?.references?.evaluator
        const candidateSlug: string | undefined =
            typeof refEvaluator?.slug === "string"
                ? refEvaluator.slug
                : typeof (step as any)?.evaluator_slug === "string"
                  ? (step as any).evaluator_slug
                  : undefined
        const candidateId: string | undefined =
            typeof refEvaluator?.id === "string" ? refEvaluator.id : undefined

        let matched = false

        if (candidateId) {
            if (evaluatorIds.has(candidateId)) {
                matched = true
            } else {
                matched = true
            }
        }

        if (!matched && candidateSlug) {
            matched = evaluatorSlugs.has(candidateSlug)
            if (!matched) {
                matched = true
            }
        }

        if (!matched) {
            const keyParts = (step.stepKey || "").split(".")
            const fallbackSlug = keyParts.length > 1 ? keyParts[keyParts.length - 1] : undefined
            if (fallbackSlug && evaluatorSlugs.has(fallbackSlug)) {
                matched = true
            }
        }

        return matched
    })

    return {inputSteps, invocationSteps, annotationSteps}
}

export function deriveTestsetAndRevision({
    inputSteps,
    invocationSteps,
    runIndex,
    testsets,
    variants,
}: {
    inputSteps: any[]
    invocationSteps: any[]
    runIndex?: {steps: Record<string, any>}
    testsets: PreviewTestset[]
    variants: EnhancedVariant[]
}): {testsets: PreviewTestset[]; revisions: EnhancedVariant[]} {
    const referencedTestsetIds = new Set<string>()
    const referencedRevisionIds = new Set<string>()

    if (runIndex) {
        inputSteps.forEach((step) => {
            const meta = runIndex.steps[step.stepKey]
            const tsId = meta?.refs?.testset?.id
            if (tsId) referencedTestsetIds.add(tsId)
        })
        invocationSteps.forEach((step) => {
            const meta = runIndex.steps[step.stepKey]
            const revId = meta?.refs?.applicationRevision?.id
            if (revId) referencedRevisionIds.add(revId)
        })
    }

    const resolvedTestsets = testsets.filter((t: any) => {
        const id = (t as any).id ?? (t as any)._id
        return referencedTestsetIds.has(id as string)
    })
    const resolvedRevisions = variants.filter((v) => referencedRevisionIds.has(v.id))

    return {testsets: resolvedTestsets, revisions: resolvedRevisions}
}

export function enrichInputSteps({
    inputSteps,
    testsets,
    revisions,
    mappings,
}: {
    inputSteps: any[]
    testsets?: any[]
    revisions?: any[]
    mappings?: any
}) {
    const findTestsetForTestcase = (tcId: string) =>
        testsets?.find(
            (ts: any) =>
                Array.isArray(ts.data?.testcases) &&
                ts.data.testcases.some((tc: any) => tc.id === tcId),
        )

    const enrichStep = (step: any) => {
        const ts = findTestsetForTestcase(step.testcaseId)

        let inputs = step.inputs ? {...step.inputs} : {}
        const groundTruth = step.groundTruth ?? {}

        const canComputeFromTestset =
            mappings && Array.isArray(testsets) && testsets.length > 0 && ts
        if (canComputeFromTestset) {
            const testcase = ts?.data?.testcases?.find((tc: any) => tc.id === step.testcaseId)
            if (testcase) {
                // We no longer rely on revision.inputParams in worker context.
                // Passing an empty list will trigger heuristic fallback in computeInputsAndGroundTruth.
                const inputParamNames: string[] = []
                const computed = computeInputsAndGroundTruth({
                    testcase,
                    mappings,
                    inputKey: step.stepKey,
                    inputParamNames,
                })
                for (const [k, v] of Object.entries(computed.inputs)) {
                    if (!(k in inputs)) (inputs as Record<string, any>)[k] = v
                }
            }
        }

        const testcase = testsets
            ?.flatMap((t: any) => t.data?.testcases || [])
            .find((tc: any) => tc.id === step.testcaseId)
        return {...step, inputs, groundTruth, testcase}
    }

    const richInputSteps = inputSteps.map((s) => enrichStep(s))
    return {richInputSteps, richInputStep: richInputSteps[0]}
}

export const prepareRequest = ({
    revision,
    inputParametersDict,
    uriObject,
    precomputedParameters,
    appType,
}: {
    revision: EnhancedVariant<any>
    inputParametersDict: Record<string, string>
    uriObject?: {runtimePrefix: string; routePath?: string}
    /** Parameters computed on main thread via transformedPromptsAtomFamily({useStableParams: true}) */
    precomputedParameters?: any
}) => {
    if (!revision || !inputParametersDict) return null

    // We no longer store chat flags on the revision; infer from inputs
    const isChatVariant = Object.prototype.hasOwnProperty.call(
        inputParametersDict || {},
        "messages",
    )
    const isCustomVariant = !!appType && appType === "custom"

    const mainInputParams: Record<string, any> = {}
    const secondaryInputParams: Record<string, string> = {}

    // Derive splitting without relying on deprecated revision.inputParams:
    // - messages => top-level (main) param for chat variants
    // - everything else => goes under `inputs`
    Object.keys(inputParametersDict).forEach((key) => {
        const val = inputParametersDict[key]
        if (key === "messages") {
            mainInputParams[key] = val
        } else {
            secondaryInputParams[key] = val
        }
    })

    // Start from stable precomputed parameters (main-thread transformed prompts)
    const baseParams = (precomputedParameters as Record<string, any>) || {}
    const requestBody: Record<string, any> = {
        ...baseParams,
        ...mainInputParams,
    }

    if (isCustomVariant) {
        for (const key of Object.keys(inputParametersDict)) {
            if (key !== "inputs") requestBody[key] = inputParametersDict[key]
        }
    } else {
        requestBody["inputs"] = {...(requestBody["inputs"] || {}), ...secondaryInputParams}
    }

    if (isChatVariant) {
        if (typeof requestBody["messages"] === "string") {
            try {
                requestBody["messages"] = JSON.parse(requestBody["messages"])
            } catch {
                throw new Error("content not valid for messages")
            }
        }
    }

    // Ensure we never crash on missing uriObject; default to empty values
    const safeUri = uriObject ?? {runtimePrefix: "", routePath: ""}

    return {
        requestBody,
        endpoint: constructPlaygroundTestUrl(safeUri, "/test", true),
    }
}

export function buildInvocationParameters({
    invocationSteps,
    inputSteps,
    uriObject,
    parametersByRevisionId,
    appType,
}: {
    invocationSteps: (IStepResponse & {revision?: any})[]
    inputSteps: (IStepResponse & {inputs?: Record<string, any>})[]
    uriObject?: {runtimePrefix: string; routePath?: string}
    /** Map of revisionId -> transformed prompts (stable) */
    parametersByRevisionId?: Record<string, any>
}) {
    const map: Record<string, any | null> = {}
    invocationSteps.forEach((step) => {
        const revision = (step as any).revision
        const matchInput = inputSteps.find((r) => r.testcaseId === step.testcaseId && r.inputs)
        if (step.status !== "success") {
            const pre = revision?.id ? parametersByRevisionId?.[revision.id] : undefined

            const params = prepareRequest({
                revision,
                inputParametersDict: matchInput?.inputs ?? {},
                uriObject,
                precomputedParameters: pre?.ag_config ? pre : pre,
                appType,
            })
            map[step.stepKey] = params
            ;(step as any).invocationParameters = params
        } else {
            map[step.stepKey] = undefined
            ;(step as any).invocationParameters = undefined
        }
    })
    return map
}

// ------------------- public worker-friendly funcs -------------------

export function computeTraceAndAnnotationRefs({
    steps,
    runIndex,
    evaluators,
}: {
    steps: StepResponseStep[]
    runIndex?: {invocationKeys: Set<string>; annotationKeys: Set<string>}
    evaluators: EvaluatorDto[]
}) {
    const invocationKeys = runIndex?.invocationKeys ?? new Set<string>()
    const annotationKeys = runIndex?.annotationKeys ?? new Set<string>()

    const traceIds = collectTraceIds({steps, invocationKeys})

    // simple evaluator-based identification
    const annotationSteps = steps.filter((s) => annotationKeys.has(s.stepKey))

    const annotationLinks = buildAnnotationLinks({
        annotationSteps,
        uuidToTraceId,
        uuidToSpanId,
    })
    return {traceIds, annotationSteps, annotationLinks}
}

export async function fetchTraceAndAnnotationMaps({
    traceIds,
    annotationLinks,
    members,
    invocationSteps,
    apiUrl,
    jwt,
    projectId,
}: {
    traceIds: string[]
    annotationLinks: {trace_id: string; span_id?: string}[]
    members: WorkspaceMember[]
    invocationSteps: any[]
    apiUrl: string
    jwt: string
    projectId: string
}): Promise<{traceMap: Map<string, TraceData>; annotationMap: Map<string, AnnotationDto>}> {
    const traceMap = new Map<string, any>()
    const annotationMap = new Map<string, AnnotationDto>()

    if (traceIds.length) {
        try {
            const filtering = JSON.stringify({
                conditions: [{key: "tree.id", operator: "in", value: traceIds}],
            })
            const params = new URLSearchParams()
            params.append("filtering", filtering)
            params.append("project_id", projectId)
            const resp = await fetch(`${apiUrl}/observability/v1/traces?${params.toString()}`, {
                headers: {Authorization: `Bearer ${jwt}`},
            })
            if (resp.ok) {
                const data = await resp.json()
                const trees = data?.trees || []
                trees.forEach((t: any) => {
                    if (t.tree?.id) traceMap.set(t.tree.id, t)
                })
            }
        } catch (err) {
            console.error("[pureEnrichment] trace fetch error", err)
        }
    }

    if (annotationLinks && annotationLinks.length > 0) {
        try {
            const resp = await fetch(
                `${apiUrl}/preview/annotations/query?project_id=${projectId}`,
                {
                    method: "POST",
                    headers: {"Content-Type": "application/json", Authorization: `Bearer ${jwt}`},
                    body: JSON.stringify({annotation_links: annotationLinks}),
                },
            )
            if (resp.ok) {
                const data = await resp.json()
                const annMap = buildAnnotationMap({
                    rawAnnotations: data?.annotations || [],
                    members,
                })
                annMap.forEach((v, k) => annotationMap.set(k, v))
            }
        } catch (err) {
            console.error("[pureEnrichment] annotation fetch error", err)
        }
    }

    return {traceMap, annotationMap}
}

// ------------------- pure implementations -------------------

export function buildScenarioCore({
    steps,
    runIndex,
    evaluators,
    testsets,
    variants,
    mappings,
    uriObject,
    parametersByRevisionId,
    appType,
}: {
    steps: StepResponseStep[]
    runIndex?: RunIndex
    evaluators: EvaluatorDto[]
    testsets: PreviewTestset[]
    variants: EnhancedVariant[]
    mappings?: unknown
    uriObject?: {runtimePrefix: string; routePath?: string}
    parametersByRevisionId?: Record<string, any>
    appType?: string
}): UseEvaluationRunScenarioStepsFetcherResult {
    const {inputSteps, invocationSteps, annotationSteps} = identifyScenarioSteps({
        steps,
        runIndex,
        evaluators,
    })

    const {testsets: derivedTestsets, revisions} = deriveTestsetAndRevision({
        inputSteps,
        invocationSteps,
        runIndex,
        testsets,
        variants,
    })

    const {richInputSteps: enrichedInputSteps} = enrichInputSteps({
        inputSteps,
        testsets: derivedTestsets,
        revisions,
        mappings,
    })

    // Attach revision object to each invocation step
    const revisionMap: Record<string, any> = {}
    revisions.forEach((rev: any) => {
        revisionMap[rev.id] = rev
    })
    const enrichedInvocationSteps = invocationSteps.map((inv) => {
        let revObj: any
        if (runIndex) {
            const meta = (runIndex as any).steps?.[inv.stepKey]
            const revId = meta?.refs?.applicationRevision?.id
            if (revId) revObj = revisionMap[revId]
        }
        return revObj ? {...inv, revision: revObj} : inv
    })

    buildInvocationParameters({
        invocationSteps: enrichedInvocationSteps,
        inputSteps: enrichedInputSteps,
        uriObject,
        parametersByRevisionId,
        appType,
    })

    return {
        inputSteps: enrichedInputSteps,
        invocationSteps: enrichedInvocationSteps,
        annotationSteps,
    }
}

export function decorateScenarioResult({
    result,
    traceMap,
    annotationMap,
    runIndex,
    uuidToTraceId: _uuidToTraceId,
}: {
    result: any
    traceMap: Map<string, any>
    annotationMap: Map<string, any>
    runIndex?: {invocationKeys: Set<string>; annotationKeys: Set<string>; inputKeys?: Set<string>}
    uuidToTraceId: (uuid: string) => string | undefined
}) {
    const invocationKeys = runIndex?.invocationKeys ?? new Set<string>()
    result.steps?.forEach((st: any) => {
        const rawTrace = st.traceId ?? st.trace_id
        const traceKey = rawTrace
        const traceHex = rawTrace?.includes("-") ? _uuidToTraceId(rawTrace) : rawTrace

        // Invocation steps
        if (invocationKeys.has(st.stepKey) || Boolean(st.references?.application)) {
            st.isInvocation = true
            if (traceKey) {
                const tw = traceMap.get(traceKey)
                if (tw) {
                    st.trace = tw.trees ? tw.trees[0] : tw
                }
            }
        }

        // Annotation steps
        if (runIndex?.annotationKeys?.has(st.stepKey)) {
            if (traceHex) {
                st.annotation = annotationMap.get(traceHex)
                const tw = traceMap.get(traceKey)
                if (tw) {
                    st.trace = tw.trees ? tw.trees[0] : tw
                }
            }
        }

        // Input steps
        if (runIndex?.inputKeys?.has(st.stepKey) && Array.isArray(result.inputSteps)) {
            const enriched = result.inputSteps.find(
                (inp: any) => inp.stepKey === st.stepKey && inp.inputs,
            )
            if (enriched) {
                st.inputs = enriched.inputs
                st.groundTruth = enriched.groundTruth
                if (st.testcaseId && enriched.testcase) {
                    st.testcase = enriched.testcase
                }
            }
        }
    })

    // Ensure invocationSteps have trace
    if (Array.isArray(result.invocationSteps)) {
        result.invocationSteps.forEach((inv: any) => {
            if (!inv.trace) {
                const tid = inv.traceId || inv.trace_id
                const tw = tid ? traceMap.get(tid) : undefined
                if (tw) {
                    inv.trace = tw.trees ? tw.trees[0] : tw
                }
            }
        })
    }
    // Propagate testcase objects
    if (Array.isArray(result.inputSteps)) {
        result.inputSteps.forEach((inp: any) => {
            if (inp.testcaseId && inp.testcase) {
                const testcaseMap: Record<string, any> = {}
                testcaseMap[inp.testcaseId] = inp.testcase
                result.steps?.forEach((st: any) => {
                    if (st.testcaseId && testcaseMap[st.testcaseId]) {
                        st.testcase = testcaseMap[st.testcaseId]
                    }
                })
            }
        })
    }
}
