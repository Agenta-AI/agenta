import {asRecord} from "@agenta/shared/utils"

export type EvaluatorVerdict = "pass" | "fail" | "unknown"

const VERDICT_KEY_PRIORITY = [
    "success",
    "passed",
    "ispass",
    "pass",
    "issuccess",
    "verdict",
] as const

const TRUE_LITERALS = new Set(["true", "pass", "passed", "success", "succeeded", "yes"])
const FALSE_LITERALS = new Set(["false", "fail", "failed", "error", "no"])

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "")
const unwrapValue = (value: unknown): unknown => {
    const rec = asRecord(value)
    if (!rec || !("value" in rec)) return value
    return rec.value
}

const extractEvaluatorDisplayObject = (output: unknown): Record<string, unknown> | null => {
    const outputObj = asRecord(output)
    const response = asRecord(outputObj?.response)
    const responseData = asRecord(response?.data)
    const nestedOutputs = asRecord(responseData?.outputs)
    const responseOutputs = asRecord(response?.outputs)
    return nestedOutputs ?? responseOutputs ?? responseData ?? response
}

const parseBooleanLike = (value: unknown): boolean | null => {
    const unwrapped = unwrapValue(value)
    if (typeof unwrapped === "boolean") return unwrapped
    if (typeof unwrapped === "number" && (unwrapped === 0 || unwrapped === 1)) {
        return unwrapped === 1
    }
    if (typeof unwrapped === "object" && unwrapped !== null) {
        const rec = asRecord(unwrapped)
        if (!rec) return null
        const nestedCandidates: unknown[] = [
            rec.success,
            rec.passed,
            rec.is_pass,
            rec.isPass,
            rec.value,
            rec.verdict,
            rec.result,
        ]
        for (const candidate of nestedCandidates) {
            const parsed = parseBooleanLike(candidate)
            if (parsed !== null) return parsed
        }
        return null
    }
    if (typeof unwrapped !== "string") return null

    const normalized = unwrapped.trim().toLowerCase()
    if (!normalized) return null
    if (TRUE_LITERALS.has(normalized)) return true
    if (FALSE_LITERALS.has(normalized)) return false
    return null
}

const parseVerdict = (value: unknown): EvaluatorVerdict => {
    const boolLike = parseBooleanLike(value)
    if (boolLike === true) return "pass"
    if (boolLike === false) return "fail"
    return "unknown"
}

export const getEvaluatorVerdictFromOutput = (output: unknown): EvaluatorVerdict => {
    const displayObject = extractEvaluatorDisplayObject(output)
    if (!displayObject) return "unknown"

    const entries = Object.entries(displayObject)
    for (const targetKey of VERDICT_KEY_PRIORITY) {
        const found = entries.find(([key]) => normalizeKey(key) === targetKey)
        if (!found) continue
        const verdict = parseVerdict(found[1])
        if (verdict !== "unknown") return verdict
    }

    const parsedValues = entries
        .map(([, value]) => parseBooleanLike(value))
        .filter((value): value is boolean => value !== null)
    if (parsedValues.some((v) => v === false)) return "fail"
    if (parsedValues.some((v) => v === true)) return "pass"

    // Fallback for one-field evaluator outputs where the sole value is boolean-like.
    if (entries.length === 1) {
        const verdict = parseVerdict(entries[0][1])
        if (verdict !== "unknown") return verdict
    }

    return "unknown"
}
