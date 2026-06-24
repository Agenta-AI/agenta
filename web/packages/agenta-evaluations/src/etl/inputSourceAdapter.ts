/**
 * Input-source adapter for evaluation run schemas.
 *
 * Both query-backed traces and testset rows use `step.type = "input"`. The
 * step references identify which storage model the input result uses:
 *
 * - query_revision -> result.trace_id -> trace data
 * - testset_revision -> result.testcase_id -> testcase data
 *
 * Keep this distinction centralized so column grouping, mapping resolution,
 * and hydration cannot drift into separate step.type-only heuristics.
 */

export type InputSourceKind = "query" | "testset"
export type InputSourceStorage = "trace" | "testcase"

export interface InputSourceStep {
    key: string
    type: string
    references?: Record<string, {id?: string; slug?: string} | null> | null
}

export interface InputSourceMapping {
    column?: {kind?: string | null; name?: string | null} | null
    step?: {key: string; path?: string | null} | null
}

export interface InputSourceGroup {
    kind: InputSourceKind
    slug: string | null
    label: string
    key: string
}

export interface InputSourceAdapter {
    kind: InputSourceKind
    storage: InputSourceStorage
    matches: (step: InputSourceStep) => boolean
    group: (step: InputSourceStep) => InputSourceGroup
    adaptMappings: (step: InputSourceStep, mapping: InputSourceMapping) => InputSourceMapping[]
    normalizeValue: (step: InputSourceStep, mapping: InputSourceMapping, value: unknown) => unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const queryAdapter: InputSourceAdapter = {
    kind: "query",
    storage: "trace",
    matches: (step) => Boolean(step.references?.query_revision || step.references?.query),
    group: (step) => {
        const slug = step.references?.query?.slug ?? step.references?.query_revision?.slug ?? null
        return {
            kind: "query",
            slug,
            label: slug ? `Query ${slug}` : "Query",
            key: `query:${slug ?? step.key}`,
        }
    },
    adaptMappings: (_step, mapping) => {
        if (mapping.column?.kind !== "query" || mapping.column.name !== "data") {
            return [mapping]
        }

        const basePath = mapping.step?.path ?? "attributes.ag.data"
        return [
            {
                column: {...mapping.column, name: "inputs"},
                step: {
                    key: mapping.step?.key ?? "",
                    path: basePath.endsWith(".inputs") ? basePath : `${basePath}.inputs`,
                },
            },
            {
                column: {...mapping.column, name: "outputs"},
                step: {
                    key: mapping.step?.key ?? "",
                    path: basePath.endsWith(".outputs") ? basePath : `${basePath}.outputs`,
                },
            },
        ]
    },
    normalizeValue: (_step, mapping, value) => {
        if (mapping.column?.name !== "inputs" || !isRecord(value) || !isRecord(value.inputs)) {
            return value
        }

        const {inputs, ...siblings} = value
        return {...inputs, ...siblings}
    },
}

const testsetAdapter: InputSourceAdapter = {
    kind: "testset",
    storage: "testcase",
    matches: (step) => Boolean(step.references?.testset_revision || step.references?.testset),
    group: (step) => {
        const slug =
            step.references?.testset?.slug ?? step.references?.testset_revision?.slug ?? null
        return {
            kind: "testset",
            slug,
            label: slug ? `Testset ${slug}` : "Testset",
            key: `testset:${slug ?? step.key}`,
        }
    },
    adaptMappings: (_step, mapping) => [mapping],
    normalizeValue: (_step, _mapping, value) => value,
}

const INPUT_SOURCE_ADAPTERS: readonly InputSourceAdapter[] = [queryAdapter, testsetAdapter]

export const getInputSourceAdapter = (
    step: InputSourceStep | null | undefined,
): InputSourceAdapter | null => {
    if (!step || step.type !== "input") return null
    return INPUT_SOURCE_ADAPTERS.find((adapter) => adapter.matches(step)) ?? null
}

export const adaptInputSourceMappings = <
    Step extends InputSourceStep,
    Mapping extends InputSourceMapping,
>(
    steps: readonly Step[],
    mappings: readonly Mapping[],
): InputSourceMapping[] => {
    const stepByKey = new Map(steps.map((step) => [step.key, step]))

    return mappings.flatMap((mapping) => {
        const stepKey = mapping.step?.key
        const step = stepKey ? stepByKey.get(stepKey) : undefined
        const adapter = getInputSourceAdapter(step)
        return adapter ? adapter.adaptMappings(step as Step, mapping) : [mapping]
    })
}

export const normalizeInputSourceValue = (
    step: InputSourceStep,
    mapping: InputSourceMapping,
    value: unknown,
): unknown => getInputSourceAdapter(step)?.normalizeValue(step, mapping, value) ?? value
