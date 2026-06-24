import type {IStepResponse, PreviewTestCase} from "../../../core"

export const splitPath = (path: string): string[] => {
    return path.split(".").filter(Boolean)
}

export const resolveValueBySegments = (source: unknown, segments: string[]): unknown => {
    if (!source) return undefined
    let current: unknown = source
    for (const segment of segments) {
        if (current == null) return undefined
        current = (current as Record<string, unknown>)?.[segment]
    }
    return current
}

export const resolveTestcaseValueByPath = (
    testcase: PreviewTestCase | null | undefined,
    pathSegments: string[],
): unknown => {
    if (!testcase) return undefined
    const working = [...pathSegments]
    if (!working.length) return undefined

    let source: unknown = testcase
    if (working[0] === "data") {
        source = testcase.data ?? testcase.inputs ?? testcase
        working.shift()
    }

    return resolveValueBySegments(source, working)
}

export const resolveInputStepValueByPath = (
    step: IStepResponse | undefined,
    pathSegments: string[],
): unknown => {
    if (!step) return undefined
    const working = [...pathSegments]
    if (!working.length) return undefined

    let source: unknown = step
    if (working[0] === "data") {
        const stepRec = step as Record<string, unknown>
        source = stepRec.inputs ?? stepRec.data ?? step
        working.shift()
    }

    return resolveValueBySegments(source, working)
}

export const resolveGenericStepValueByPath = (
    step: IStepResponse | undefined,
    pathSegments: string[],
): unknown => {
    if (!step) return undefined
    return resolveValueBySegments(step, pathSegments)
}
