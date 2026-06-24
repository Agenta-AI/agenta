/**
 * Scenario list-column definition types — relocated faithfully from
 * `@agenta/annotation`'s `state/types.ts` (`ScenarioListColumnDef` union).
 *
 * The only adaptation is the evaluator-column reference: the annotation
 * `AnnotationColumnDef` is the evaluations `EvaluatorColumnDef` (identical
 * shape), so these reference `EvaluatorColumnDef` from the scenario-data module.
 */

import type {EvaluatorColumnDef} from "../scenarioData/types"

/**
 * Discriminated union of column types for the scenario list table.
 * The `columnType` field determines how the presentation layer renders each column.
 */
export type ScenarioListColumnDef =
    | IndexColumnDef
    | TraceNameColumnDef
    | TraceInputGroupColumnDef
    | TraceOutputColumnDef
    | TestcaseColumnDef
    | AnnotationDataColumnDef
    | StatusColumnDef
    | ActionsColumnDef

interface BaseColumnDef {
    key: string
    title: string
    width: number
    fixed?: "left" | "right"
}

export interface IndexColumnDef extends BaseColumnDef {
    columnType: "index"
}

export interface TraceNameColumnDef extends BaseColumnDef {
    columnType: "trace-name"
}

export interface TraceInputGroupColumnDef extends BaseColumnDef {
    columnType: "trace-input-group"
    /** Individual input keys to show as sub-columns. Empty = show all inputs in one column. */
    inputKeys: string[]
}

export interface TraceOutputColumnDef extends BaseColumnDef {
    columnType: "trace-output"
}

export interface TestcaseColumnDef extends BaseColumnDef {
    columnType: "testcase-input" | "testcase-output" | "testcase-expected"
    /** Key to read from scenario record (supports "meta.xxx" paths) */
    dataKey: string
}

export interface AnnotationDataColumnDef extends BaseColumnDef {
    columnType: "annotation"
    annotationDef: EvaluatorColumnDef
    /** Output keys from the evaluator's output schema (used for sub-columns). */
    outputKeys: string[]
    /** Concrete child columns under the evaluator parent. */
    outputColumns?: AnnotationOutputColumnDef[]
    /** Testcase data key to fall back to when the same logical column exists in synced testcase data. */
    fallbackDataKey?: string | null
}

export interface AnnotationOutputColumnDef {
    /** Stable child column key, unique within the table. */
    key: string
    /** Child column label shown under the evaluator parent. */
    title: string
    /** Mapping definition used to resolve this child cell value. */
    annotationDef: EvaluatorColumnDef
}

export interface StatusColumnDef extends BaseColumnDef {
    columnType: "status"
}

export interface ActionsColumnDef extends BaseColumnDef {
    columnType: "actions"
}
