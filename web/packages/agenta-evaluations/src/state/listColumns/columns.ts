/**
 * Generic list-column tier — relocated faithfully from `@agenta/annotation`'s
 * annotationSessionController. Re-parameterized to read the session engine's
 * INJECTED scenario-source `kind` + `{projectId, runId}` context (via
 * `evaluationSessionController.selectors`) and the generic scenario-data
 * selectors (`scenarioDataSelectors`) instead of queue concepts.
 *
 * These are SESSION-SCOPED selectors (they read the singleton engine), so they
 * are exposed as zero-arg atom getters like the engine selectors, NOT keyed
 * families.
 */

import {fetchTestcasesBatch, type Testcase} from "@agenta/entities/testcase"
import {traceInputsAtomFamily} from "@agenta/entities/trace"
import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, type Getter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomWithQuery} from "jotai-tanstack-query"

import {scenarioDataSelectors} from "../scenarioData"
import type {EvaluatorColumnDef} from "../scenarioData/types"
import {evaluationSessionController} from "../session"

import {getTraceInputDisplayKeys} from "./traceInputDisplay"
import type {ScenarioListColumnDef} from "./types"

type ScenarioRecord = Record<string, unknown>

// ============================================================================
// COLUMN DISCOVERY HELPERS (for testcase-based scenario sources)
// ============================================================================

/** System keys to exclude from testcase data columns (internal fields not for display) */
const TESTCASE_SYSTEM_KEYS = new Set(["testcase_dedup_id", "__dedup_id__"])

/** Keys to exclude from display in testcase columns */
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
    "status",
    "interval",
    "timestamp",
])

/** Keys that represent outputs */
export const OUTPUT_KEYS = new Set(["output", "outputs", "result", "response", "completion"])

/** Keys that represent expected/reference outputs */
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

/** Keys that represent metadata (tags/meta) */
const META_KEYS = new Set(["tags", "meta"])

type TestcaseColumnGroup = "input" | "output" | "expected"

function getAnnotationDisplayTitle(get: Getter, def: EvaluatorColumnDef): string {
    const evaluatorLookupId = def.evaluatorRevisionId ?? def.evaluatorId
    const evaluator = evaluatorLookupId
        ? get(workflowMolecule.selectors.data(evaluatorLookupId))
        : null
    return (
        evaluator?.name?.trim() ||
        def.evaluatorSlug?.trim() ||
        evaluator?.slug?.trim() ||
        def.columnName?.trim() ||
        def.stepKey?.trim() ||
        ""
    )
}

function getAnnotationGroupKey(get: Getter, def: EvaluatorColumnDef): string {
    return (
        def.evaluatorId?.trim() ||
        def.evaluatorSlug?.trim() ||
        getAnnotationDisplayTitle(get, def).trim().toLowerCase() ||
        def.stepKey
    )
}

function stripOutputPathPrefix(path: string): string {
    for (const prefix of ["attributes.ag.data.outputs.", "data.outputs.", "outputs."]) {
        if (path.startsWith(prefix)) {
            return path.slice(prefix.length)
        }
    }
    return path
}

function getAnnotationChildTitle(def: EvaluatorColumnDef): string {
    const path = def.path?.trim()
    if (path) {
        const stripped = stripOutputPathPrefix(path)
        if (stripped && stripped !== path) return stripped

        const leaf = stripped.split(".").filter(Boolean).at(-1)
        if (leaf && leaf !== "outputs") return leaf
    }

    return def.columnName?.trim() || def.stepKey
}

/**
 * Analyze scenario records to discover dynamic testcase columns.
 * Returns column definitions grouped by input/output/expected.
 */
function discoverTestcaseColumns(
    scenarios: ScenarioRecord[],
): {key: string; title: string; group: TestcaseColumnGroup}[] {
    const seen = new Map<string, TestcaseColumnGroup>()

    for (const scenario of scenarios) {
        for (const key of Object.keys(scenario)) {
            if (EXCLUDE_KEYS.has(key) || META_KEYS.has(key) || seen.has(key)) continue

            let group: TestcaseColumnGroup = "input"
            if (OUTPUT_KEYS.has(key)) group = "output"
            else if (EXPECTED_OUTPUT_KEYS.has(key)) group = "expected"

            seen.set(key, group)
        }

        // Also inspect `meta` for nested data fields
        const meta = scenario.meta
        if (meta && typeof meta === "object") {
            for (const key of Object.keys(meta as Record<string, unknown>)) {
                const prefixed = `meta.${key}`
                if (seen.has(prefixed)) continue
                if (["trace_id", "span_id"].includes(key)) continue

                let group: TestcaseColumnGroup = "input"
                if (OUTPUT_KEYS.has(key)) group = "output"
                else if (EXPECTED_OUTPUT_KEYS.has(key)) group = "expected"

                seen.set(prefixed, group)
            }
        }
    }

    return Array.from(seen.entries()).map(([key, group]) => ({
        key,
        title: key.startsWith("meta.") ? key.slice(5) : key,
        group,
    }))
}

// ============================================================================
// SESSION CONTEXT HELPERS
// ============================================================================

function readSessionContext(get: Getter): {projectId: string; runId: string} | null {
    const context = get(evaluationSessionController.selectors.context())
    if (!context?.projectId || !context?.runId) return null
    return {projectId: context.projectId, runId: context.runId}
}

// ============================================================================
// DERIVED ATOMS — input-key discovery
// ============================================================================

/**
 * Trace input keys — discovered from the first scenario's trace inputs.
 * Used by the list view to build per-key input columns for trace-based sources.
 *
 * Reactively resolves: scenarioIds[0] → traceRef → traceInputs → Object.keys()
 */
const traceInputKeysAtom = atom<string[]>((get) => {
    const kind = get(evaluationSessionController.selectors.scenarioKind())
    if (kind !== "traces") return []

    const ids = get(evaluationSessionController.selectors.scenarioIds())
    if (ids.length === 0) return []

    // Resolve the first scenario's trace ID
    const firstScenarioId = ids[0]
    const context = readSessionContext(get)
    if (!context || !firstScenarioId) return []

    const traceRef = get(
        scenarioDataSelectors.scenarioTraceRef({
            projectId: context.projectId,
            runId: context.runId,
            scenarioId: firstScenarioId,
        }),
    )
    const traceId = traceRef?.traceId
    if (!traceId) return []

    // Read the trace inputs and extract keys
    const inputs = get(traceInputsAtomFamily(traceId))
    if (!inputs) return []

    return getTraceInputDisplayKeys(inputs)
})

/**
 * All testcase IDs referenced by the current session scenarios.
 * Used for batch testcase fetch + unioned column discovery.
 */
const scenarioTestcaseIdsAtom = atom<string[]>((get) => {
    const kind = get(evaluationSessionController.selectors.scenarioKind())
    if (kind !== "testcases") return []

    const context = readSessionContext(get)
    if (!context) return []

    const scenarioIds = get(evaluationSessionController.selectors.scenarioIds())
    const seen = new Set<string>()

    for (const scenarioId of scenarioIds) {
        const testcaseId = get(
            scenarioDataSelectors.scenarioTestcaseRef({
                projectId: context.projectId,
                runId: context.runId,
                scenarioId,
            }),
        ).testcaseId
        if (testcaseId) {
            seen.add(testcaseId)
        }
    }

    return Array.from(seen)
})

/**
 * Batch testcase data for all testcase scenarios in the current session.
 * Used for unioned testcase column discovery across the whole run.
 */
const scenarioTestcasesQueryAtom = atomWithQuery<Testcase[]>((get) => {
    const context = readSessionContext(get)
    const runId = context?.runId ?? null
    const testcaseIds = get(scenarioTestcaseIdsAtom)

    return {
        queryKey: ["evaluations-testcases-batch", runId ?? "none", testcaseIds],
        queryFn: async () => {
            const sessionContext = getDefaultStore().get(
                evaluationSessionController.selectors.context(),
            )
            const projectId = sessionContext?.projectId ?? null
            if (testcaseIds.length === 0) return []
            if (!projectId) {
                throw new Error("projectId not yet available")
            }

            const testcaseMap = await fetchTestcasesBatch({projectId, testcaseIds})
            return testcaseIds
                .map((testcaseId) => testcaseMap.get(testcaseId) ?? null)
                .filter((testcase): testcase is Testcase => testcase !== null)
        },
        enabled: testcaseIds.length > 0,
        retry: (failureCount: number, error: Error) => {
            if (error?.message === "projectId not yet available" && failureCount < 5) {
                return true
            }
            return false
        },
        retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Testcase input keys — discovered from all testcase data in the session.
 * Used by the list view to build per-key columns for testcase-based sources.
 *
 * Reactively resolves: scenarioIds[] → testcaseIds[] → batched testcase fetch → union(Object.keys(data))
 */
const testcaseInputKeysAtom = atom<string[]>((get) => {
    const kind = get(evaluationSessionController.selectors.scenarioKind())
    if (kind !== "testcases") return []

    const query = get(scenarioTestcasesQueryAtom)
    const testcases = query.data ?? []
    if (testcases.length === 0) return []

    const keys = new Set<string>()
    for (const testcase of testcases) {
        for (const key of Object.keys(testcase.data ?? {})) {
            if (!TESTCASE_SYSTEM_KEYS.has(key)) {
                keys.add(key)
            }
        }
    }

    return Array.from(keys)
})

// ============================================================================
// DERIVED ATOM — Full list column definitions
// ============================================================================

/**
 * Complete ordered list of column definitions for the scenario list table.
 * Combines: index + data columns (trace or testcase) + annotation columns + status + actions.
 *
 * The presentation layer maps each def to a renderer based on `columnType`.
 */
const listColumnDefsAtom = atom<ScenarioListColumnDef[]>((get) => {
    const kind = get(evaluationSessionController.selectors.scenarioKind())
    const inputKeys = get(traceInputKeysAtom)
    const context = readSessionContext(get)
    const annotationDefs = context
        ? (get(
              scenarioDataSelectors.evaluatorColumnDefs({
                  projectId: context.projectId,
                  runId: context.runId,
              }),
          ) as EvaluatorColumnDef[])
        : []
    const records = get(evaluationSessionController.selectors.scenarioRecords()) as ScenarioRecord[]
    // Note: if two annotation defs resolve to the same lowercase title, the later one wins.
    // This is acceptable since duplicate evaluator names within a single run are uncommon.
    const annotationColumnsByTitle = new Map(
        annotationDefs
            .map((def) => {
                const title = getAnnotationDisplayTitle(get, def)
                return title ? ([title.trim().toLowerCase(), def] as const) : null
            })
            .filter((entry): entry is readonly [string, EvaluatorColumnDef] => entry !== null),
    )
    const mergedFallbackKeys = new Map<string, string>()

    // Leading: index column
    const leading: ScenarioListColumnDef[] = [
        {columnType: "index", key: "__index", title: "#", width: 64, fixed: "left"},
    ]

    // Data columns depend on the scenario-source kind
    let dataColumns: ScenarioListColumnDef[] = []

    if (kind === "traces") {
        // Trace-based: name + per-key inputs (or fallback) + outputs
        const traceName: ScenarioListColumnDef = {
            columnType: "trace-name",
            key: "__trace_name",
            title: "Trace",
            width: 180,
        }

        const traceInputGroup: ScenarioListColumnDef = {
            columnType: "trace-input-group",
            key: "__trace_inputs",
            title: "Inputs",
            width: inputKeys.length > 1 ? 250 * inputKeys.length : 300,
            inputKeys,
        }

        const traceOutput: ScenarioListColumnDef = {
            columnType: "trace-output",
            key: "__trace_outputs",
            title: "Outputs",
            width: 300,
        }

        dataColumns = [traceName, traceInputGroup, traceOutput]
    } else {
        // Testcase-based: discover columns from fetched testcase data keys
        const testcaseKeys = get(testcaseInputKeysAtom)

        if (testcaseKeys.length > 0) {
            // Categorize keys using the same sets used for scenario records
            const inputCols: string[] = []
            const outputCols: string[] = []
            const expectedCols: string[] = []

            for (const key of testcaseKeys) {
                const normalizedKey = key.trim().toLowerCase()
                if (annotationColumnsByTitle.has(normalizedKey)) {
                    mergedFallbackKeys.set(normalizedKey, key)
                    continue
                }
                if (OUTPUT_KEYS.has(key)) outputCols.push(key)
                else if (EXPECTED_OUTPUT_KEYS.has(key)) expectedCols.push(key)
                else inputCols.push(key)
            }

            dataColumns = [
                ...inputCols.map(
                    (key): ScenarioListColumnDef => ({
                        columnType: "testcase-input",
                        key,
                        title: key,
                        width: 200,
                        dataKey: key,
                    }),
                ),
                ...outputCols.map(
                    (key): ScenarioListColumnDef => ({
                        columnType: "testcase-output",
                        key,
                        title: key,
                        width: 200,
                        dataKey: key,
                    }),
                ),
                ...expectedCols.map(
                    (key): ScenarioListColumnDef => ({
                        columnType: "testcase-expected",
                        key,
                        title: key,
                        width: 200,
                        dataKey: key,
                    }),
                ),
            ]
        } else {
            // Fallback: discover from scenario records (works if data is inline)
            const discovered = discoverTestcaseColumns(records).filter((col) => {
                const normalizedTitle = col.title.trim().toLowerCase()
                if (annotationColumnsByTitle.has(normalizedTitle)) {
                    mergedFallbackKeys.set(normalizedTitle, col.key)
                    return false
                }
                return true
            })
            const inputColsF = discovered.filter((c) => c.group === "input")
            const outputColsF = discovered.filter((c) => c.group === "output")
            const expectedColsF = discovered.filter((c) => c.group === "expected")

            dataColumns = [
                ...inputColsF.map(
                    (col): ScenarioListColumnDef => ({
                        columnType: "testcase-input",
                        key: col.key,
                        title: col.title,
                        width: 200,
                        dataKey: col.key,
                    }),
                ),
                ...outputColsF.map(
                    (col): ScenarioListColumnDef => ({
                        columnType: "testcase-output",
                        key: col.key,
                        title: col.title,
                        width: 200,
                        dataKey: col.key,
                    }),
                ),
                ...expectedColsF.map(
                    (col): ScenarioListColumnDef => ({
                        columnType: "testcase-expected",
                        key: col.key,
                        title: col.title,
                        width: 200,
                        dataKey: col.key,
                    }),
                ),
            ]
        }
    }

    // Annotation columns — group mapping columns under their evaluator parent.
    const annotationGroups = new Map<
        string,
        {title: string; defs: EvaluatorColumnDef[]; fallbackDataKey: string | null}
    >()
    for (const def of annotationDefs) {
        const displayTitle = getAnnotationDisplayTitle(get, def)
        const groupKey = getAnnotationGroupKey(get, def)
        const existing = annotationGroups.get(groupKey)

        if (existing) {
            existing.defs.push(def)
            continue
        }

        annotationGroups.set(groupKey, {
            title: displayTitle || def.columnName || def.evaluatorSlug || def.stepKey,
            defs: [def],
            fallbackDataKey: mergedFallbackKeys.get(displayTitle.trim().toLowerCase()) ?? null,
        })
    }

    const annotationColumns: ScenarioListColumnDef[] = Array.from(annotationGroups.entries()).map(
        ([groupKey, group]) => {
            const childTitleCounts = new Map<string, number>()
            const outputColumns = group.defs.map((def) => {
                const title = getAnnotationChildTitle(def)
                const count = childTitleCounts.get(title) ?? 0
                childTitleCounts.set(title, count + 1)

                return {
                    key: `__annot_${groupKey}_${title}_${count}`,
                    title,
                    annotationDef: def,
                }
            })

            return {
                columnType: "annotation" as const,
                key: `__annot_${groupKey}`,
                title: group.title,
                width: 150 * Math.max(outputColumns.length, 1),
                annotationDef: group.defs[0],
                outputKeys: outputColumns.map((column) => column.title),
                outputColumns,
                fallbackDataKey: group.fallbackDataKey,
            }
        },
    )

    // Trailing: review status + actions
    const trailing: ScenarioListColumnDef[] = [
        {columnType: "status", key: "__status", title: "Review Status", width: 120},
        {columnType: "actions", key: "__actions", title: "", width: 48},
    ]

    return [...leading, ...dataColumns, ...annotationColumns, ...trailing]
})

// ============================================================================
// SELECTOR SURFACE
// ============================================================================

/**
 * Session-scoped list-column selectors — zero-arg atom getters that read the
 * singleton session engine (kind + context) and the generic scenario-data
 * selectors. Mirrors the `evaluationSessionController.selectors` access pattern.
 */
export const listColumnSelectors = {
    /** Trace input keys discovered from the first scenario's trace data */
    traceInputKeys: () => traceInputKeysAtom,
    /** Testcase input keys discovered from the session's testcase data */
    testcaseInputKeys: () => testcaseInputKeysAtom,
    /** All testcase IDs referenced by the current session scenarios */
    scenarioTestcaseIds: () => scenarioTestcaseIdsAtom,
    /** Batch testcase data query for the session's testcase scenarios */
    scenarioTestcasesQuery: () => scenarioTestcasesQueryAtom,
    /** Full ordered list of column definitions for the scenario list table */
    listColumnDefs: () => listColumnDefsAtom,
}

export type ListColumnSelectors = typeof listColumnSelectors
