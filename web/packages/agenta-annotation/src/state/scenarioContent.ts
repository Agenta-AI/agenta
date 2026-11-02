/**
 * Splits a scenario or test case into the sections the annotation session shows.
 *
 * Plain functions with no UI library, so the antd view and the /m view group fields the same way.
 */

/** Keys to exclude from display entirely. */
const EXCLUDE_KEYS = new Set([
    "id",
    "created_at",
    "updated_at",
    "created_by_id",
    "updated_by_id",
    "run_id",
    "version",
    "__isSkeleton",
    "key",
    "trace_id",
    "span_id",
    "testcase_dedup_id",
    "__dedup_id__",
])

/** Keys that hold scenario metadata (shown in a separate section). */
const META_KEYS = new Set(["status", "interval", "timestamp"])

/** Keys that point at a trace or span (not shown as data). */
const TRACE_REF_KEYS = new Set(["trace_id", "span_id"])

/** System keys a test case row carries (not shown as data). */
const TESTCASE_SYSTEM_KEYS = new Set(["testcase_dedup_id", "__dedup_id__"])

/** Keys that usually hold outputs. */
const OUTPUT_KEYS = new Set(["output", "outputs", "result", "response", "completion"])

/** Keys that usually hold the expected (reference) output of a test case. */
const EXPECTED_OUTPUT_KEYS = new Set([
    "expected_output",
    "expected",
    "reference",
    "reference_output",
    "ground_truth",
    "golden",
    "target",
    "correct_answer",
])

export type ScenarioEntry = [string, unknown]

export interface CategorizedScenario {
    inputs: ScenarioEntry[]
    outputs: ScenarioEntry[]
    expectedOutputs: ScenarioEntry[]
    metaEntries: ScenarioEntry[]
    tags: Record<string, unknown> | null
}

/** Shows a value as text: "—" for nothing, JSON for objects. */
export function formatScenarioValue(value: unknown): string {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value || "—"
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number") return String(value)
    return JSON.stringify(value, null, 2)
}

/** Whether a value needs a block (an object, or a string over 200 characters) instead of a line. */
export function isComplexScenarioValue(value: unknown): boolean {
    if (value === null || value === undefined) return false
    if (typeof value === "object") return true
    if (typeof value === "string" && value.length > 200) return true
    return false
}

/** Groups the fields of a scenario record into inputs, outputs, expected outputs, status and tags. */
export function categorizeScenarioEntries(scenario: Record<string, unknown>): CategorizedScenario {
    const inputs: ScenarioEntry[] = []
    const outputs: ScenarioEntry[] = []
    const expectedOutputs: ScenarioEntry[] = []
    const metaEntries: ScenarioEntry[] = []
    let tags: Record<string, unknown> | null = null

    for (const [key, value] of Object.entries(scenario)) {
        if (EXCLUDE_KEYS.has(key)) continue

        if (key === "tags" && value && typeof value === "object") {
            const filteredTags: Record<string, unknown> = {}
            for (const [tagKey, tagValue] of Object.entries(value as Record<string, unknown>)) {
                if (!TRACE_REF_KEYS.has(tagKey)) filteredTags[tagKey] = tagValue
            }
            if (Object.keys(filteredTags).length > 0) tags = filteredTags
            continue
        }

        if (key === "meta" && value && typeof value === "object") {
            for (const [metaKey, metaValue] of Object.entries(value as Record<string, unknown>)) {
                if (TRACE_REF_KEYS.has(metaKey)) continue
                if (META_KEYS.has(metaKey)) metaEntries.push([metaKey, metaValue])
                else if (OUTPUT_KEYS.has(metaKey)) outputs.push([metaKey, metaValue])
                else if (EXPECTED_OUTPUT_KEYS.has(metaKey))
                    expectedOutputs.push([metaKey, metaValue])
                else inputs.push([metaKey, metaValue])
            }
            continue
        }

        if (META_KEYS.has(key)) {
            metaEntries.push([key, value])
            continue
        }

        if (OUTPUT_KEYS.has(key)) outputs.push([key, value])
        else if (EXPECTED_OUTPUT_KEYS.has(key)) expectedOutputs.push([key, value])
        else inputs.push([key, value])
    }

    return {inputs, outputs, expectedOutputs, metaEntries, tags}
}

/** Groups the data fields of a test case into inputs, outputs and expected outputs. */
export function categorizeTestcaseFields(data: Record<string, unknown> | null | undefined): {
    inputs: ScenarioEntry[]
    outputs: ScenarioEntry[]
    expectedOutputs: ScenarioEntry[]
} {
    const inputs: ScenarioEntry[] = []
    const outputs: ScenarioEntry[] = []
    const expectedOutputs: ScenarioEntry[] = []
    if (!data || typeof data !== "object") return {inputs, outputs, expectedOutputs}

    for (const [key, value] of Object.entries(data)) {
        if (TESTCASE_SYSTEM_KEYS.has(key)) continue
        if (OUTPUT_KEYS.has(key)) outputs.push([key, value])
        else if (EXPECTED_OUTPUT_KEYS.has(key)) expectedOutputs.push([key, value])
        else inputs.push([key, value])
    }
    return {inputs, outputs, expectedOutputs}
}
