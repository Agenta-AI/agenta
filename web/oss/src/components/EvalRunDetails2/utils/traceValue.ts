import {resolvePath as resolveTracePath} from "@/oss/lib/traces/traceUtils"
import type {TraceData} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

import {resolveValueBySegments, splitPath} from "./valueAccess"

const INVOCATION_OUTPUT_KEY_MAP: Record<string, string> = {
    "attributes.ag.data.outputs": "data.outputs",
    "attributes.ag.data": "data",
}

const fallbackCache = new Map<string, string[]>()

export const buildInvocationFallbackPaths = (path: string, valueKey?: string): string[] => {
    const cacheKey = `${path}::${valueKey ?? ""}`
    const cached = fallbackCache.get(cacheKey)
    if (cached) return cached

    const candidates = new Set<string>()
    const add = (candidate?: string) => {
        if (!candidate) return
        candidates.add(candidate)
    }

    add(path)
    add(INVOCATION_OUTPUT_KEY_MAP[path])

    const stripPrefix = (prefix: string, value: string) =>
        value.startsWith(prefix) ? value.slice(prefix.length) : undefined

    const baseSegments = path.split(".").filter(Boolean)
    const baseRemainder =
        stripPrefix("attributes.ag.data.", path) ??
        stripPrefix("attributes.ag.", path) ??
        stripPrefix("attributes.", path) ??
        stripPrefix("data.", path) ??
        stripPrefix("result.", path) ??
        path

    add(baseRemainder)
    add(`data.${baseRemainder}`)
    add(`result.${baseRemainder}`)
    add(`attributes.${baseRemainder}`)
    add(`attributes.ag.${baseRemainder}`)
    add(`attributes.ag.data.${baseRemainder}`)

    if (baseRemainder && !baseRemainder.startsWith("outputs")) {
        add(`outputs.${baseRemainder}`)
        add(`data.outputs.${baseRemainder}`)
        add(`result.outputs.${baseRemainder}`)
        add(`attributes.ag.data.outputs.${baseRemainder}`)
    } else if (baseRemainder === "outputs") {
        add("data.outputs")
        add("result.outputs")
        add("attributes.ag.data.outputs")
    }

    if (baseSegments.length > 1 && baseSegments[0] === "attributes") {
        add(baseSegments.slice(1).join("."))
    }
    if (baseSegments.length > 1 && baseSegments[0] === "outputs") {
        const remainder = baseSegments.slice(1).join(".")
        add(remainder)
        add(`data.${remainder}`)
        add(`result.${remainder}`)
    }

    const nodePrefixes = ["nodes.0", "tree.nodes.0", "trees.0.nodes.0"]
    nodePrefixes.forEach((prefix) => {
        add(`${prefix}.${baseRemainder}`)
        add(`${prefix}.data.${baseRemainder}`)
        add(`${prefix}.result.${baseRemainder}`)
        add(`${prefix}.outputs`)
        if (!baseRemainder.startsWith("outputs")) {
            add(`${prefix}.outputs.${baseRemainder}`)
        }
    })

    if (valueKey) {
        add(valueKey)
        add(`data.${valueKey}`)
        add(`result.${valueKey}`)
        add(`outputs.${valueKey}`)
    }

    const result = Array.from(candidates)
    fallbackCache.set(cacheKey, result)
    return result
}

export const resolveWithFallbackPaths = (
    sources: (unknown | undefined)[],
    primaryPath: string,
    valueKey?: string,
): unknown => {
    const candidates = buildInvocationFallbackPaths(primaryPath, valueKey)
    for (const path of candidates) {
        for (const source of sources) {
            if (!source) continue
            const resolved = resolveTracePath(source, path)
            if (resolved !== undefined) {
                return resolved
            }
        }
    }

    return undefined
}

export const resolveInvocationTraceValue = (
    trace: TraceData | null | undefined,
    primaryPath: string,
    valueKey?: string,
): unknown => {
    if (!trace) return undefined

    const sources: unknown[] = []
    const seen = new Set<unknown>()
    const push = (candidate: unknown) => {
        if (!candidate) return
        if (seen.has(candidate)) return
        seen.add(candidate)
        sources.push(candidate)
    }

    const candidateTrees: any[] = []
    if (Array.isArray(trace.trees) && trace.trees.length) {
        candidateTrees.push(...trace.trees)
    }
    if ((trace as any).tree) {
        candidateTrees.push((trace as any).tree)
    }

    candidateTrees.forEach((tree) => {
        push(tree)
        if (Array.isArray(tree.nodes)) {
            tree.nodes.forEach(push)
        }
        push((tree as any).data)
        push(tree.tree)
    })

    if (Array.isArray((trace as any).nodes)) {
        ;((trace as any).nodes as unknown[]).forEach(push)
    }

    push((trace as any).data)
    push((trace as any).result)
    push((trace as any).outputs)
    push(trace)

    const resolved = resolveWithFallbackPaths(sources, primaryPath, valueKey)
    if (resolved !== undefined) return resolved

    const candidates = buildInvocationFallbackPaths(primaryPath, valueKey).map((path) =>
        splitPath(path),
    )

    const tryResolve = (source: unknown): unknown => {
        if (!source || typeof source !== "object") return undefined
        for (const segments of candidates) {
            if (!segments.length) continue
            const value = resolveValueBySegments(source, segments)
            if (value !== undefined) {
                return value
            }
        }
        return undefined
    }

    const spanContainers: Record<string, any>[] = []

    if ((trace as any)?.tree?.data?.spans) {
        spanContainers.push((trace as any).tree.data.spans)
    }
    if (Array.isArray(trace?.trees)) {
        trace.trees.forEach((tree: any) => {
            if (tree?.data?.spans) {
                spanContainers.push(tree.data.spans)
            }
        })
    }

    for (const container of spanContainers) {
        const spans = Object.values(container ?? {}) as any[]
        for (const span of spans) {
            const valueFromSpan = tryResolve(span)
            if (valueFromSpan !== undefined) return valueFromSpan
            const valueFromSpanData = tryResolve(span?.data)
            if (valueFromSpanData !== undefined) return valueFromSpanData
            const valueFromSpanAttributes = tryResolve(span?.data?.attributes)
            if (valueFromSpanAttributes !== undefined) return valueFromSpanAttributes
        }
    }

    return undefined
}
