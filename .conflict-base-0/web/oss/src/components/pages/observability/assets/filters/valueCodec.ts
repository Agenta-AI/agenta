import {Filter} from "@/oss/lib/Types"
import {coerceNumericValue} from "@/oss/state/newObservability"

import {ScalarType, ValueShape, valueShapeFor} from "./operatorRegistry"

const toStringList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String)
    if (v == null) return []
    const s = String(v).trim()
    if (!s) return []
    if (s.startsWith("[") && s.endsWith("]")) {
        try {
            const arr = JSON.parse(s)
            if (Array.isArray(arr)) return arr.map(String)
        } catch {}
    }
    return s
        .split(/[\s,;\n\r\t]+/g)
        .map((t) => t.trim())
        .filter(Boolean)
}

const toNumberPair = (v: unknown): number[] => {
    const out: number[] = []
    const push = (raw: any) => {
        const n = coerceNumericValue(raw) as any
        if (typeof n === "number" && Number.isFinite(n)) out.push(n)
    }
    if (Array.isArray(v)) v.slice(0, 2).forEach(push)
    else if (typeof v === "string") {
        const s = v.trim()
        if (!s) return []
        if (s.startsWith("[") && s.endsWith("]")) {
            try {
                const arr = JSON.parse(s)
                if (Array.isArray(arr)) arr.slice(0, 2).forEach(push)
            } catch {}
        } else
            s.split(/[\s,;\n\r\t]+/g)
                .filter(Boolean)
                .slice(0, 2)
                .forEach(push)
    }
    return out.length === 2 ? out : []
}

export interface NormalizerCtx {
    fieldType: ScalarType
    opId: Filter["operator"]
    toExternal?: (normalized: any) => any
    toUI?: (external: any) => any
}

export const normalizeValue = (raw: unknown, shape: ValueShape, t: ScalarType) => {
    if (shape === "none") return ""
    if (shape === "range") return toNumberPair(raw)
    if (shape === "list") {
        if (Array.isArray(raw)) {
            const hasObjects = raw.some(
                (item) => item !== null && typeof item === "object" && !Array.isArray(item),
            )
            if (hasObjects) return raw
            const list = (raw as unknown[]).map((entry) => String(entry))
            return t === "number" ? list.map(coerceNumericValue) : list
        }
        const list = toStringList(raw)
        return t === "number" ? list.map(coerceNumericValue) : list
    }
    if (Array.isArray(raw)) return raw[0] ?? ""
    return t === "number" ? coerceNumericValue(raw as any) : (raw ?? "")
}

export const toUIValue = (external: any, shape: ValueShape) => {
    if (shape === "none") return ""
    if (shape === "range") return Array.isArray(external) ? external : []
    if (shape === "list") return Array.isArray(external) ? external : toStringList(external)
    return Array.isArray(external) ? (external[0] ?? "") : external
}

export const normalizeFilter = (f: Filter, ctx: NormalizerCtx): Filter => {
    const shape = valueShapeFor(ctx.opId, ctx.fieldType)
    const normalized = normalizeValue(f.value, shape, ctx.fieldType)
    const value = ctx.toExternal ? ctx.toExternal(normalized) : normalized
    return {...f, value}
}
