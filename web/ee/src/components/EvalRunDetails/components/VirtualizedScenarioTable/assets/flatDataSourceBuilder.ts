import React from "react"

import {readInvocationResponse} from "@/oss/lib/helpers/traceUtils"
import {
    evalAtomStore,
    loadableScenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import type {
    RunIndex,
    ColumnDef,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {EvaluationStatus} from "@/oss/lib/Types"

import type {TableRow} from "../types"

import ActionCell from "./ActionCell"
import {CellWrapper} from "./CellComponents"
import {COLUMN_WIDTHS} from "./constants"
import StatusCell from "./StatusCell"
/**
 * Convert input/metric/etc key parts to a flat column key we can feed to AntD's dataIndex.
 */
function makeColKey(kind: string, key: string): string {
    return `${kind}.${key}`
}

// ---------------- Helpers ------------------
export const titleCase = (str: string) =>
    String(str || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[a-z]|\s[a-z]/g, (m) => m.toUpperCase())

// --------------------- Main Builder ---------------------

export interface BuildFlatArgs {
    scenarioIds: string[]
    statusMap: Record<string, {status: EvaluationStatus; result?: any} | undefined>
    allScenariosLoaded: boolean
    runIndex: RunIndex | null | undefined
    evaluators: any[]
    metricValuesMap: Record<string, Record<string, any>>
    skeletonCount?: number
}

/**
 * Build a *flat* data source where each row already contains every cell value.
 * Columns are generated alongside with minimal metadata.
 */
// --------------------------------------------------
// Ant Design column helper for flat data rows
// --------------------------------------------------

type ExtendedColumnDef = Omit<ColumnDef, "kind"> & {kind: string; path: string}

export function buildFlatAntdColumns(columns: ExtendedColumnDef[]): any[] {
    const metricCols: ExtendedColumnDef[] = []
    const _annotationGroups: Record<string, ExtendedColumnDef[]> = {}
    const normalCols: ExtendedColumnDef[] = []
    for (const c of columns) {
        // Skip generic "outputs" invocation placeholder; keep default-guid columns
        if (c.kind === "invocation" && c.name === "outputs") {
            continue
        }
        if (c.kind === "invocation" && /^default-[a-f0-9]+$/i.test(c.name)) {
            const renamed: ExtendedColumnDef = {...c, name: "outputs", key: c.key}
            normalCols.push(renamed)
            continue
        }
        if (c.kind === "metric") metricCols.push(c)
        else if (c.kind === "annotation") {
            const m = c.key.match(/^annotation\.([^.]+)\.(.+)$/)
            if (m) {
                const [, evaluator, metricName] = m
                const childDef: ExtendedColumnDef = {...c, name: metricName}
                ;(_annotationGroups[evaluator] ||= []).push(childDef)
            } else {
                ;(_annotationGroups[c.name] ||= []).push(c)
            }
        } else {
            normalCols.push(c)
        }
    }
    const toAnt = (c: ExtendedColumnDef): any => {
        const common: any = {
            title:
                c.kind === "input"
                    ? `Input [${c.name}]`
                    : c.kind === "invocation"
                      ? titleCase(c.name)
                      : c.kind === "metric"
                        ? c.name
                        : c.kind === "annotation"
                          ? titleCase(c.name)
                          : c.name,
            key: c.key,
            dataIndex: c.key,
            width:
                c.kind === "meta"
                    ? 80
                    : c.kind === "input"
                      ? COLUMN_WIDTHS.input
                      : c.kind === "metric" || c.kind === "annotation"
                        ? COLUMN_WIDTHS.metric
                        : c.kind === "invocation"
                          ? COLUMN_WIDTHS.response
                          : 120,
        }
        if (c.kind === "meta") {
            switch (c.path) {
                case "scenarioIndex":
                    return {
                        ...common,
                        fixed: "left",
                        width: 50,
                        render: (_: any, record: any) =>
                            React.createElement(CellWrapper, null, record.scenarioIndex),
                    }
                case "status":
                    return {
                        ...common,
                        width: 100,
                        render: (_: any, record: any) =>
                            React.createElement(StatusCell, {
                                scenarioId: record.key as string,
                                result: record.result,
                            }),
                    }
                case "action":
                    return {
                        ...common,
                        fixed: "right",
                        width: 120,
                        render: (_: any, record: any) =>
                            React.createElement(ActionCell, {scenarioId: record.key}),
                    }
                default:
                    return common
            }
        }
        if (c.kind === "invocation") {
            return {
                ...common,
                render: (_: any, record: any) => {
                    const cell = record[c.key]
                    const val = cell && typeof cell === "object" ? cell.value : cell
                    const content =
                        val != null && val !== ""
                            ? String(val)
                            : React.createElement("i", null, "N/A")
                    return React.createElement(CellWrapper, {className: "text-wrap"}, content)
                },
            }
        }
        if (c.kind === "metric") {
            return {
                ...common,
                sorter: (a: any, b: any) => {
                    const v1 = a[c.key]
                    const v2 = b[c.key]
                    const n1 = Number(v1)
                    const n2 = Number(v2)
                    if (!isNaN(n1) && !isNaN(n2)) return n1 - n2
                    return String(v1).localeCompare(String(v2))
                },
            }
        }
        return common
    }

    // Separate action column if present so we can always push it to the very end
    const actionIndex = normalCols.findIndex((c) => c.key === "meta.action")
    const actionColDef = actionIndex >= 0 ? normalCols.splice(actionIndex, 1)[0] : undefined

    const antInitial = normalCols.map(toAnt)

    // Build annotation groups per evaluator
    const antAnnotationGroups = Object.entries(_annotationGroups).map(([evaluator, cols]) => ({
        title: evaluator,
        key: `annotation-${evaluator}`,
        children: cols.map(toAnt),
    }))

    // Build metric group if any
    const antMetricGroup = metricCols.length
        ? {
              title: "Metrics",
              key: "metrics-group",
              children: metricCols.map(toAnt),
          }
        : null

    // Combine in correct display order: annotations (rank 4) before metrics (rank 5)
    let antColumnsOrdered = [...antInitial, ...antAnnotationGroups]
    if (antMetricGroup) antColumnsOrdered.push(antMetricGroup)

    if (actionColDef) {
        antColumnsOrdered.push(toAnt(actionColDef))
    }

    return antColumnsOrdered
}

export function buildFlatScenarioTableData({
    scenarioIds,
    statusMap,
    allScenariosLoaded,
    runIndex,
    evaluators = [],
    metricValuesMap = {},
    skeletonCount = 20,
}: BuildFlatArgs): {rows: TableRow[]; columns: ColumnDef[]} {
    // 1. Fast-path skeleton rows until data is ready
    if (!allScenariosLoaded) {
        const rows: TableRow[] = Array.from({length: skeletonCount}, (_, idx) => ({
            key: `skeleton-${idx}`,
            scenarioIndex: idx + 1,
            isSkeleton: true,
        }))
        return {rows, columns: []}
    }

    const rows: TableRow[] = []
    const columnSet = new Set<string>() // Collect dynamic column keys

    const store = evalAtomStore()

    scenarioIds.forEach((scenarioId, idx) => {
        const row: any = {
            key: scenarioId,
            scenarioIndex: idx + 1,
        }
        columnSet.add("meta.scenarioIndex")
        columnSet.add("meta.action")

        // ---- Status / result meta ----
        const st = statusMap[scenarioId]
        const uiStatus = (st as any)?.uiStatus as string | undefined
        row.status = uiStatus ?? st?.status ?? "pending"
        columnSet.add("meta.status")
        if (st?.result !== undefined) {
            const r = typeof st.result === "string" ? st.result : JSON.stringify(st.result)
            row.result = r.length > 120 ? `${r.slice(0, 117)}…` : r
            columnSet.add("meta.result")
        }

        // Override status using step data to detect INCOMPLETE after invocation success but annotation pending
        // INCOMPLETE: at least one invocation success and at least one annotation not success
        // SUCCESS: all annotations success

        const deriveStatusFromSteps = (data: any, current: string): string => {
            if (!data) return current
            const invArr: any[] = data.invocationSteps || []
            const annArr: any[] = data.annotationSteps || []
            if (invArr.length === 0) return current
            const allInvOk = invArr.every((s) => s.status === "success")
            if (!allInvOk) return current
            if (annArr.length === 0) return current
            const allAnnOk = annArr.every((s) => s.status === "success")
            if (allAnnOk) return "success"
            const anyAnnPending = annArr.some((s) =>
                ["pending", "running", "queued"].includes(s.status),
            )
            if (anyAnnPending) return "incomplete"
            return current
        }

        // ---- Step data ----
        const stepLoadable = store.get(loadableScenarioStepFamily(scenarioId))
        const stepData = stepLoadable.state === "hasData" ? stepLoadable.data : undefined
        row.status = deriveStatusFromSteps(stepData, row.status)
        if (stepData) {
            // Inputs
            stepData.inputSteps?.forEach((step: any) => {
                Object.entries(step.inputs || {}).forEach(([k, v]: [string, any]) => {
                    const colKey = makeColKey("input", k)
                    row[colKey] = v
                    columnSet.add(colKey)
                })
            })

            // Invocation outputs
            stepData.invocationSteps?.forEach((inv: any) => {
                const {value, trace} = readInvocationResponse({
                    scenarioData: stepData,
                    stepKey: inv.key,
                })
                const colKey = makeColKey("invocation", inv.key)
                row[colKey] = {value, trace}
                columnSet.add(colKey)
            })

            // Annotation values (flatten first available annotation)
            const ann =
                stepData.annotation || (stepData.annotations ? stepData.annotations[0] : undefined)
            if (ann) {
                const flatten = (obj: any, prefix = "") => {
                    Object.entries(obj).forEach(([k, v]) => {
                        const p = prefix ? `${prefix}.${k}` : k
                        if (v && typeof v === "object" && !Array.isArray(v)) {
                            flatten(v, p)
                        } else {
                            const colKey = makeColKey("annotation", p)
                            row[colKey] = v
                            columnSet.add(colKey)
                        }
                    })
                }
                flatten(ann)
            }
        }

        // ---- Metrics ----
        const metricVals = metricValuesMap[scenarioId] || {}
        const collectMetric = (obj: any, prefix = "") => {
            Object.entries(obj).forEach(([k, v]) => {
                const p = prefix ? `${prefix}.${k}` : k
                if (v && typeof v === "object" && !Array.isArray(v)) {
                    collectMetric(v, p)
                } else {
                    const kind = p.includes(".") ? "evaluator" : "metric"
                    const colKey = makeColKey(kind, p)
                    row[colKey] = v
                    columnSet.add(colKey)
                }
            })
        }
        collectMetric(metricVals)

        rows.push(row)
    })

    // Add columns from runIndex even if no data yet (e.g., evaluator annotation metrics)
    if (runIndex) {
        Object.values(runIndex.columnsByStep)
            .flat()
            .forEach((c) => {
                const inferredKey = makeColKey(c.kind, c.name)
                columnSet.add(inferredKey)
            })
    }

    // ------------- Build ColumnDef list -------------
    const makeDef = (key: string): ColumnDef => {
        const [kind, rest] = key.split(".", 2)
        return {
            key,
            name: rest,
            kind: kind as any,
            path: rest,
            stepKey: rest, // not strictly right but unused in flat mode
        }
    }
    const orderRank = (def: ColumnDef): number => {
        if (def.key === "meta.scenarioIndex") return 0
        if (def.key === "meta.status") return 1
        if (def.kind === "input") return 2
        if (def.kind === "invocation") return 3
        if (def.kind === "annotation") return 4
        if (def.kind === "metric") return 5
        return 6
    }

    const columns: ColumnDef[] = Array.from(columnSet)
        .map(makeDef)
        .sort((a, b) => {
            const r = orderRank(a) - orderRank(b)
            if (r !== 0) return r
            return a.name.localeCompare(b.name)
        })

    return {rows, columns}
}
