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
import type {
    AgentaConfigPrompt,
    EnhancedObjectConfig,
} from "@/oss/lib/shared/variant/genericTransformer/types"
import {constructPlaygroundTestUrl} from "@/oss/lib/shared/variant/stringUtils"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {PreviewTestSet, WorkspaceMember} from "@/oss/lib/Types"

function collectTraceIds({steps, invocationKeys}: {steps: any[]; invocationKeys: Set<string>}) {
    const traceIds: string[] = []
    steps.forEach((st: any) => {
        if (invocationKeys.has(st.key) && st.traceId) traceIds.push(st.traceId)
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

/** Simple dot-path resolver ("a.b.c") */
export function resolvePath(obj: any, path: string): any {
    return path.split(".").reduce((o: any, key: string) => (o ? o[key] : undefined), obj)
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

    const inputMappings = (mappings ?? []).filter(
        (m) =>
            m.step.key === inputKey &&
            (isRevisionKnown
                ? inputParamNames.includes(m.column?.name)
                : m.column?.kind === "testset"),
    )

    const groundTruthMappings = (mappings ?? []).filter(
        (m) =>
            m.step.key === inputKey && !inputMappings.includes(m) && m.column?.kind === "testset",
    )

    const objFor = (filtered: any[]) =>
        filtered.reduce((acc: any, m: any) => {
            let val = resolvePath(testcase, m.step.path)
            if (val === undefined && m.step.path.startsWith("data.")) {
                val = resolvePath(testcase, m.step.path.slice(5))
            }
            if (val !== undefined) acc[m.column?.name || m.name] = val
            return acc
        }, {})

    return {
        inputs: objFor(inputMappings),
        groundTruth: objFor(groundTruthMappings),
    }
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
    const inputSteps = steps.filter((s) => runIndex?.inputKeys?.has(s.key))

    const invocationKeys = runIndex?.invocationKeys ?? new Set<string>()
    const invocationSteps = steps.filter((s) => invocationKeys.has(s.key))

    const annotationSteps = steps.filter((s) => {
        const keyParts = (s.key || "").split(".")
        const evaluatorSlug = keyParts.length > 1 ? keyParts[keyParts.length - 1] : undefined
        return evaluatorSlug ? evaluators.some((e) => e.slug === evaluatorSlug) : false
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
    testsets: PreviewTestSet[]
    variants: EnhancedVariant[]
}): {testsets: PreviewTestSet[]; revisions: EnhancedVariant[]} {
    const referencedTestsetIds = new Set<string>()
    const referencedRevisionIds = new Set<string>()

    if (runIndex) {
        inputSteps.forEach((step) => {
            const meta = runIndex.steps[step.key]
            const tsId = meta?.refs?.testset?.id
            if (tsId) referencedTestsetIds.add(tsId)
        })
        invocationSteps.forEach((step) => {
            const meta = runIndex.steps[step.key]
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
                const inputParamNamesSet = new Set<string>()
                if (Array.isArray(revisions)) {
                    revisions.forEach((rev: any) => {
                        const reqSchema = rev.requestSchema
                        if (reqSchema) {
                            if (Array.isArray(reqSchema.required)) {
                                reqSchema.required.forEach((rk: string) => {
                                    if (rk === "inputs" && Array.isArray(reqSchema.inputKeys)) {
                                        reqSchema.inputKeys.forEach((k: string) =>
                                            inputParamNamesSet.add(k),
                                        )
                                    } else {
                                        inputParamNamesSet.add(rk)
                                    }
                                })
                            }
                            if (Array.isArray(reqSchema.inputKeys)) {
                                reqSchema.inputKeys.forEach((k: string) =>
                                    inputParamNamesSet.add(k),
                                )
                            }
                        } else if (Array.isArray(rev.inputParams)) {
                            rev.inputParams.forEach((p: any) => inputParamNamesSet.add(p.name))
                        }
                    })
                }
                const inputParamNames = Array.from(inputParamNamesSet)
                const computed = computeInputsAndGroundTruth({
                    testcase,
                    mappings,
                    inputKey: step.key,
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
}: {
    revision: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>
    inputParametersDict: Record<string, string>
}) => {
    if (!revision || !inputParametersDict) return null

    const isChatVariant = revision.isChatVariant
    const isCustomVariant = revision.isCustom
    const inputParamDefinition = revision.inputParams || []
    // In worker context we cannot read metadata atom; pass empty object instead
    const optionalParameters =
        revision.optionalParameters || transformToRequestBody({variant: revision, allMetadata: {}})

    const mainInputParams: Record<string, any> = {}
    const secondaryInputParams: Record<string, string> = {}

    for (const key of Object.keys(inputParametersDict)) {
        const paramDefinition = inputParamDefinition.find((param) => param.name === key)
        if (paramDefinition && !paramDefinition.input) {
            secondaryInputParams[key] = inputParametersDict[key]
        } else {
            mainInputParams[key] = inputParametersDict[key]
        }
    }

    const optParams = Array.isArray(optionalParameters)
        ? optionalParameters
              .filter((param) => param.type !== "object")
              .reduce((acc: any, param) => {
                  acc[param.name] = param.default
                  return acc
              }, {})
        : optionalParameters

    const requestBody: Record<string, any> = {
        ...optParams,
        ...mainInputParams,
    }

    if (isCustomVariant) {
        for (const key of Object.keys(inputParametersDict)) {
            if (key !== "inputs") requestBody[key] = inputParametersDict[key]
        }
    } else if (isChatVariant) {
        requestBody["inputs"] = secondaryInputParams
        if (typeof requestBody["messages"] === "string") {
            try {
                requestBody["messages"] = JSON.parse(requestBody["messages"])
            } catch {
                throw new Error("content not valid for messages")
            }
        }
    } else {
        requestBody["inputs"] = secondaryInputParams
    }

    return {
        requestBody,
        endpoint: constructPlaygroundTestUrl(revision.uriObject!, "/test", true),
    }
}

export function buildInvocationParameters({
    invocationSteps,
    inputSteps,
}: {
    invocationSteps: (IStepResponse & {revision?: any})[]
    inputSteps: (IStepResponse & {inputs?: Record<string, any>})[]
}) {
    const map: Record<string, any | null> = {}
    invocationSteps.forEach((step) => {
        const revision = (step as any).revision
        const matchInput = inputSteps.find((r) => r.testcaseId === step.testcaseId && r.inputs)
        if (step.status !== "success") {
            const params = prepareRequest({
                revision,
                inputParametersDict: matchInput?.inputs ?? {},
            })
            map[step.key] = params
            ;(step as any).invocationParameters = params
        } else {
            map[step.key] = undefined
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
    const annotationSteps = steps.filter((s) => annotationKeys.has(s.key))

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
}: {
    steps: StepResponseStep[]
    runIndex?: RunIndex
    evaluators: EvaluatorDto[]
    testsets: PreviewTestSet[]
    variants: EnhancedVariant[]
    mappings?: unknown
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
            const meta = (runIndex as any).steps?.[inv.key]
            const revId = meta?.refs?.applicationRevision?.id
            if (revId) revObj = revisionMap[revId]
        }
        return revObj ? {...inv, revision: revObj} : inv
    })

    buildInvocationParameters({
        invocationSteps: enrichedInvocationSteps,
        inputSteps: enrichedInputSteps,
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
        if (invocationKeys.has(st.key) || Boolean(st.references?.application)) {
            st.isInvocation = true
            if (traceKey) {
                const tw = traceMap.get(traceKey)
                if (tw) {
                    st.trace = tw.trees ? tw.trees[0] : tw
                }
            }
        }

        // Annotation steps
        if (runIndex?.annotationKeys?.has(st.key)) {
            if (traceHex) {
                st.annotation = annotationMap.get(traceHex)
                const tw = traceMap.get(traceKey)
                if (tw) {
                    st.trace = tw.trees ? tw.trees[0] : tw
                }
            }
        }

        // Input steps
        if (runIndex?.inputKeys?.has(st.key) && Array.isArray(result.inputSteps)) {
            const enriched = result.inputSteps.find((inp: any) => inp.key === st.key && inp.inputs)
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
