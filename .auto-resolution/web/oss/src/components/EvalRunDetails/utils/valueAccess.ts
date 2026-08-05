import type {IStepResponse} from "@/oss/lib/evaluations"
import type {PreviewTestCase} from "@/oss/lib/Types"

export const splitPath = (path: string): string[] => {
    return path.split(".").filter(Boolean)
}

export const resolveValueBySegments = (source: unknown, segments: string[]): any => {
    if (!source) return undefined
    let current: any = source
    for (const segment of segments) {
        if (current == null) return undefined
        current = current?.[segment as keyof typeof current]
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

    let source: any = testcase
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

    let source: any = step
    if (working[0] === "data") {
        source = (step as any).inputs ?? (step as any).data ?? step
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
