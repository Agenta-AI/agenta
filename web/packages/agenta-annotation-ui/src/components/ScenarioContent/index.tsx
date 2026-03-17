/**
 * ScenarioContent
 *
 * Displays the content of a scenario in the annotation session.
 * Supports trace-based and testcase-based queue types.
 *
 * - Traces: Uses an injected TraceContentRenderer (via AnnotationUIContext) for
 *   rich drill-in rendering. Falls back to basic DataSection display when no
 *   renderer is provided.
 * - Test cases: Displays full test case row — inputs, expected output, all columns
 */

import {memo, useMemo} from "react"

import {
    traceEntityAtomFamily,
    traceRootSpanAtomFamily,
    traceInputsAtomFamily,
    traceOutputsAtomFamily,
} from "@agenta/entities/trace"
import {Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {
    useTestcaseContentRenderer,
    useTraceContentRenderer,
} from "../../context/AnnotationUIContext"

// ============================================================================
// TYPES
// ============================================================================

interface ScenarioContentProps {
    scenario: Record<string, unknown> | null
    queueKind: string
    traceId?: string
    testcaseId?: string
}

// ============================================================================
// HELPERS
// ============================================================================

/** Keys to exclude from display entirely */
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
])

/** Keys that represent scenario metadata (shown in a separate section) */
const META_KEYS = new Set(["status", "interval", "timestamp"])

/** Keys that identify trace/span references (not displayed as data) */
const TRACE_REF_KEYS = new Set(["trace_id", "span_id"])

/** Keys typically representing outputs */
const OUTPUT_KEYS = new Set(["output", "outputs", "result", "response", "completion"])

/** Keys typically representing expected/reference outputs (for test cases) */
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

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value || "—"
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number") return String(value)
    return JSON.stringify(value, null, 2)
}

function isComplexValue(value: unknown): boolean {
    if (value === null || value === undefined) return false
    if (typeof value === "object") return true
    if (typeof value === "string" && value.length > 200) return true
    return false
}

/**
 * Categorize scenario entries into structured sections (for test cases).
 */
function categorizeEntries(scenario: Record<string, unknown>) {
    const inputs: [string, unknown][] = []
    const outputs: [string, unknown][] = []
    const expectedOutputs: [string, unknown][] = []
    const metaEntries: [string, unknown][] = []
    let tags: Record<string, unknown> | null = null

    for (const [key, value] of Object.entries(scenario)) {
        if (EXCLUDE_KEYS.has(key)) continue

        // Tags section
        if (key === "tags" && value && typeof value === "object") {
            const tagObj = value as Record<string, unknown>
            const filteredTags: Record<string, unknown> = {}
            for (const [tk, tv] of Object.entries(tagObj)) {
                if (!TRACE_REF_KEYS.has(tk)) filteredTags[tk] = tv
            }
            if (Object.keys(filteredTags).length > 0) tags = filteredTags
            continue
        }

        // Meta section — flatten into appropriate buckets
        if (key === "meta" && value && typeof value === "object") {
            for (const [mk, mv] of Object.entries(value as Record<string, unknown>)) {
                if (TRACE_REF_KEYS.has(mk)) continue
                if (META_KEYS.has(mk)) {
                    metaEntries.push([mk, mv])
                } else if (OUTPUT_KEYS.has(mk)) {
                    outputs.push([mk, mv])
                } else if (EXPECTED_OUTPUT_KEYS.has(mk)) {
                    expectedOutputs.push([mk, mv])
                } else {
                    inputs.push([mk, mv])
                }
            }
            continue
        }

        // Status/interval/timestamp metadata
        if (META_KEYS.has(key)) {
            metaEntries.push([key, value])
            continue
        }

        // Categorize by key name
        if (OUTPUT_KEYS.has(key)) {
            outputs.push([key, value])
        } else if (EXPECTED_OUTPUT_KEYS.has(key)) {
            expectedOutputs.push([key, value])
        } else {
            inputs.push([key, value])
        }
    }

    return {inputs, outputs, expectedOutputs, metaEntries, tags}
}

// ============================================================================
// SECTION COMPONENTS
// ============================================================================

const DataSection = memo(function DataSection({
    title,
    entries,
}: {
    title: string
    entries: [string, unknown][]
}) {
    if (entries.length === 0) return null

    return (
        <div className="flex flex-col gap-2">
            <Typography.Text type="secondary" className="text-xs uppercase tracking-wide">
                {title}
            </Typography.Text>
            <div className="flex flex-col gap-3">
                {entries.map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1">
                        <Typography.Text className="text-xs font-medium text-[#758391]">
                            {key}
                        </Typography.Text>
                        {isComplexValue(value) ? (
                            <pre className="text-xs m-0 whitespace-pre-wrap break-all max-h-80 overflow-auto p-2 rounded bg-[var(--ant-color-fill-quaternary)]">
                                {formatValue(value)}
                            </pre>
                        ) : (
                            <Typography.Text className="text-sm">
                                {formatValue(value)}
                            </Typography.Text>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
})

/**
 * Converts a Record<string, unknown> to [key, value][] entries for DataSection.
 */
function recordToEntries(record: Record<string, unknown> | null | undefined): [string, unknown][] {
    if (!record || typeof record !== "object") return []
    return Object.entries(record).filter(([, v]) => v !== null && v !== undefined)
}

/**
 * Convert outputs (which can be any type) to [key, value][] for DataSection.
 */
function outputsToEntries(outputs: unknown): [string, unknown][] {
    if (outputs === null || outputs === undefined) return []
    if (typeof outputs === "object" && !Array.isArray(outputs)) {
        return Object.entries(outputs as Record<string, unknown>).filter(
            ([, v]) => v !== null && v !== undefined,
        )
    }
    return [["output", outputs]]
}

// ============================================================================
// TRACE CONTENT
// ============================================================================

/**
 * Displays trace data fetched via traceEntityAtomFamily.
 * Uses an injected TraceContentRenderer for rich rendering when available,
 * otherwise falls back to basic DataSection display.
 */
const TraceScenarioContent = memo(function TraceScenarioContent({traceId}: {traceId: string}) {
    const TraceContentRenderer = useTraceContentRenderer()

    const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId))
    const inputs = useAtomValue(traceInputsAtomFamily(traceId))
    const outputs = useAtomValue(traceOutputsAtomFamily(traceId))

    const inputEntries = useMemo(() => recordToEntries(inputs), [inputs])
    const outputEntries = useMemo(() => outputsToEntries(outputs), [outputs])

    if (traceQuery.isPending) {
        return (
            <div className="flex flex-col gap-4 p-4">
                <Skeleton active paragraph={{rows: 4}} />
            </div>
        )
    }

    if (traceQuery.isError || !rootSpan) {
        return (
            <div className="flex flex-col gap-4 p-4">
                <div className="flex items-center justify-center py-10">
                    <Typography.Text type="secondary">
                        {traceQuery.isError
                            ? "Failed to load trace data"
                            : "Trace data not available"}
                    </Typography.Text>
                </div>
            </div>
        )
    }

    // Rich rendering if host injected a renderer
    if (TraceContentRenderer) {
        return (
            <div className="flex flex-col h-full overflow-y-auto">
                <TraceContentRenderer traceId={traceId} spanId={rootSpan.span_id} />
            </div>
        )
    }

    // Fallback: basic DataSection rendering
    const hasData = inputEntries.length > 0 || outputEntries.length > 0

    return (
        <div className="flex flex-col gap-4 h-full overflow-y-auto p-4">
            {/* Trace / span info */}
            {rootSpan.span_name && (
                <div className="flex items-center gap-2">
                    <Typography.Text type="secondary" className="text-xs">
                        Trace:
                    </Typography.Text>
                    <Typography.Text className="text-xs font-medium">
                        {rootSpan.span_name}
                    </Typography.Text>
                    {rootSpan.span_type && (
                        <Typography.Text type="secondary" className="text-xs px-1.5 py-0.5 rounded">
                            {rootSpan.span_type}
                        </Typography.Text>
                    )}
                </div>
            )}

            {/* Inputs */}
            <DataSection title="Inputs" entries={inputEntries} />

            {/* Outputs */}
            {outputEntries.length > 0 && <DataSection title="Outputs" entries={outputEntries} />}

            {/* Empty state */}
            {!hasData && (
                <div className="flex items-center justify-center py-10">
                    <Typography.Text type="secondary">
                        No input/output data available for this trace
                    </Typography.Text>
                </div>
            )}
        </div>
    )
})

// ============================================================================
// TESTCASE CONTENT
// ============================================================================

/**
 * Displays test case data.
 * When a TestcaseContentRenderer is injected via context and testcaseId is available,
 * delegates to the rich renderer (drill-in view with format switching).
 * Otherwise falls back to basic DataSection rendering from the scenario record.
 */
const TestcaseScenarioContent = memo(function TestcaseScenarioContent({
    scenario,
    testcaseId,
}: {
    scenario: Record<string, unknown>
    testcaseId?: string
}) {
    const TestcaseContentRenderer = useTestcaseContentRenderer()

    const {inputs, outputs, expectedOutputs, metaEntries, tags} = useMemo(
        () => categorizeEntries(scenario),
        [scenario],
    )

    const hasData = inputs.length > 0 || outputs.length > 0 || expectedOutputs.length > 0

    // Rich rendering if host injected a renderer and we have a testcaseId
    if (TestcaseContentRenderer && testcaseId) {
        return (
            <div className="flex flex-col h-full overflow-y-auto">
                <TestcaseContentRenderer testcaseId={testcaseId} />
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 h-full overflow-y-auto p-4">
            <DataSection title="Inputs" entries={inputs} />

            {outputs.length > 0 && <DataSection title="Outputs" entries={outputs} />}

            {expectedOutputs.length > 0 && (
                <DataSection title="Expected Output" entries={expectedOutputs} />
            )}

            {tags && Object.keys(tags).length > 0 && (
                <DataSection title="Tags" entries={Object.entries(tags)} />
            )}

            {metaEntries.length > 0 && <DataSection title="Status" entries={metaEntries} />}

            {!hasData && metaEntries.length === 0 && (
                <div className="flex items-center justify-center py-10">
                    <Typography.Text type="secondary">
                        No data available for this scenario
                    </Typography.Text>
                </div>
            )}
        </div>
    )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const ScenarioContent = memo(function ScenarioContent({
    scenario,
    queueKind,
    traceId,
    testcaseId,
}: ScenarioContentProps) {
    if (!scenario) {
        return (
            <div className="flex items-center justify-center h-full py-20">
                <Typography.Text type="secondary">No scenario selected</Typography.Text>
            </div>
        )
    }

    const isTrace = queueKind === "traces"

    // For traces with a valid trace ID, fetch the full trace and display root span data
    if (isTrace && traceId) {
        return <TraceScenarioContent traceId={traceId} />
    }

    // For test cases, fetch testcase data by ID and display
    return <TestcaseScenarioContent scenario={scenario} testcaseId={testcaseId} />
})

export default ScenarioContent
