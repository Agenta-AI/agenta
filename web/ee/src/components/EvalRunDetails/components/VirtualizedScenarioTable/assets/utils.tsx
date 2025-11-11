import {DownOutlined, RightOutlined} from "@ant-design/icons"
import {ColumnsType} from "antd/es/table"

import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {
    metricDataFamily,
    runMetricsStatsAtom,
    scenarioMetricValueFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"
import {buildMetricSorter} from "@/oss/lib/metricSorter"
import {extractPrimitive, isSortableMetricType, maxChildWidth} from "@/oss/lib/metricUtils"

import type {TableRow} from "../types"

import ActionCell from "./ActionCell"
import {
    CellWrapper,
    Expandable,
    InputCell,
    InvocationResultCell,
    SkeletonCell,
} from "./CellComponents"
import {COLUMN_WIDTHS} from "./constants"
import {titleCase} from "./flatDataSourceBuilder"
/* SKELETON_ROW_COUNT reserved for future dynamic skeleton sizing */
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {ColumnDef} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import EvaluationCell from "./EvaluationCell"
import CollapsedAnnotationValueCell from "./MetricCell/CollapsedAnnotationValueCell"
import CollapsedMetricValueCell from "./MetricCell/CollapsedMetricValueCell"
import {AnnotationValueCell, MetricValueCell} from "./MetricCell/MetricCell"
import StatusCell from "./StatusCell"
import {getMetricConfig} from "@/oss/lib/metrics/utils"

// Helper to compare metric/annotation primitives across scenarios
function scenarioMetricPrimitive(recordKey: string, column: any) {
    const st = evalAtomStore()
    let raw: any = column.values?.[recordKey]
    if (raw === undefined) {
        if (column.kind === "metric") {
            raw = st.get(scenarioMetricValueFamily({scenarioId: recordKey, metricKey: column.path}))
        } else {
            const stepSlug =
                column.stepKey && column.stepKey.includes(".")
                    ? column.stepKey.split(".")[1]
                    : undefined
            raw = st.get(
                metricDataFamily({
                    scenarioId: recordKey,
                    stepSlug,
                    metricKey: column.name || "",
                }) as any,
            )?.value
        }
    }
    return extractPrimitive(raw)
}

function scenarioMetricSorter(column: any) {
    return buildMetricSorter<TableRow>((row) => scenarioMetricPrimitive(row.key as string, column))
}

// Local table types & components

/**
 * Transforms a list of scenario metrics into a map of scenarioId -> metrics, merging
 * nested metrics under `outputs` into the same level.
 *
 * @param {{scenarioMetrics: any[]}} props - The props object containing the metrics.
 * @returns {Record<string, Record<string, any>>} - A map of scenarioId -> metrics.
 */
export const getScenarioMetricsMap = ({scenarioMetrics}: {scenarioMetrics: any[]}) => {
    const map: Record<string, Record<string, any>> = {}
    const _metrics = scenarioMetrics || []

    _metrics.forEach((m: any) => {
        const sid = m.scenarioId
        if (!sid) return

        // Clone the data object to avoid accidental mutations
        const data: Record<string, any> =
            m && typeof m === "object" && m.data && typeof m.data === "object" ? {...m.data} : {}

        // If metrics are nested under `outputs`, merge them into the same level
        if (data.outputs && typeof data.outputs === "object") {
            Object.assign(data, data.outputs)
            delete data.outputs
        }

        if (!map[sid]) map[sid] = {}
        Object.assign(map[sid], data)
    })

    return map
}

// ---------------- Column adapter ------------------
const generateColumnTitle = (col: any) => {
    if (col.kind === "input") return `Input [${titleCase(col.name)}]`
    if (col.kind === "invocation") return titleCase(col.name)
    if (col.kind === "annotation") return titleCase(col.name)
    if (
        ["totalCost", "errors", "duration", "tokens", "promptTokens", "completionTokens"].includes(
            col.path,
        )
    )
        return getMetricConfig(col.path).label
    return titleCase(col.title ?? col.name)
}
const generateColumnWidth = (col: any) => {
    if (col.kind === "meta") return 80
    if (col.kind === "input") return COLUMN_WIDTHS.input
    if (col.kind === "metric") return COLUMN_WIDTHS.metric
    if (col.kind === "annotation") return COLUMN_WIDTHS.metric
    if (col.kind === "invocation") return COLUMN_WIDTHS.response
    return 20
}
const orderRank = (def: ColumnDef): number => {
    if (def.key === "#") return 0
    if (def.key === "inputs_group") return 1
    if (def.key === "evaluations") return 2
    if (def.key === "outputs") return 3
    if (def.key === "Status") return 4
    if (def.key === "annotation" || def.key?.includes("metrics")) return 5
    if (def.key?.includes("evaluators")) return 6
    if (def.key === "__metrics_group__") return 7
    return 8
}

export function buildAntdColumns(
    cols: any[],
    // distMap: Record<string, any>,
    collapsed: Record<string, boolean>,
    toggle: (k: string) => void,
    evaluationRunName?: string,
): ColumnsType<TableRow> {
    const distMap = evalAtomStore().get(runMetricsStatsAtom)
    const evalType = evalAtomStore().get(evalTypeAtom)

    // Count how many input columns we have
    const inputColumns = cols.filter((col) => col.kind === "input")
    return cols
        .map((c: any) => {
            if (c.children) {
                // drop empty wrapper groups
                if ((!c.title && !c.name) || c.kind === "metrics_group") {
                    return buildAntdColumns(c.children, distMap, collapsed, toggle)
                }
                if (c.key === "__metrics_group__" || c.key?.startsWith("metrics_")) {
                    const isCollapsed = collapsed[c.key]
                    return {
                        fixed: "left",
                        title: (
                            <span
                                className="flex items-center gap-1 whitespace-nowrap"
                                // onClick={(e) => {
                                //     e.stopPropagation()
                                //     toggle(c.key)
                                // }}
                            >
                                {/* {isCollapsed ? <RightOutlined /> : <DownOutlined />}{" "} */}
                                {c.key === "__metrics_group__"
                                    ? "Metrics"
                                    : titleCase(c.title ?? "")}
                            </span>
                        ),
                        dataIndex: c.key,
                        key: c.key,
                        ...(isCollapsed
                            ? {
                                  // Render single cell with aggregated values when collapsed
                                  ...(() => {
                                      const childMax = maxChildWidth(c.children || [], distMap, 160)
                                      return {width: childMax, minWidth: childMax}
                                  })(),
                                  render: (_: any, record: TableRow) => {
                                      const hasAnnotation =
                                          Array.isArray(c.children) &&
                                          c.children.some((ch: any) => ch.kind === "annotation")
                                      const evaluatorSlug =
                                          c.key === "__metrics_group__"
                                              ? undefined
                                              : c.name || c.key.replace(/^metrics_/, "")
                                      if (hasAnnotation) {
                                          return (
                                              <CollapsedAnnotationValueCell
                                                  scenarioId={record.key}
                                                  childrenDefs={c.children}
                                              />
                                          )
                                      }
                                      return (
                                          <CollapsedMetricValueCell
                                              scenarioId={record.key}
                                              evaluatorSlug={evaluatorSlug}
                                          />
                                      )
                                  },
                              }
                            : {
                                  children: buildAntdColumns(
                                      c.children,
                                      distMap,
                                      collapsed,
                                      toggle,
                                  ),
                              }),
                    }
                }

                return {
                    title: titleCase(c.title ?? c.name),
                    key: c.key ?? c.name,
                    children: buildAntdColumns(c.children, distMap, collapsed, toggle),
                }
            }

            const common = {
                metricType: c.metricType ?? c.kind,
                title: generateColumnTitle(c),
                key: c.key ?? c.name,
                minWidth: generateColumnWidth(c),
                width: generateColumnWidth(c),
            }

            if (c.kind === "meta") {
                switch (c.path) {
                    case "scenarioIndex":
                        return {
                            ...common,
                            fixed: "left",
                            width: 50,
                            minWidth: 50,
                            render: (_: any, record: TableRow) => (
                                <CellWrapper>{record.scenarioIndex}</CellWrapper>
                            ),
                        }
                    // case "evaluations":
                    //     if (evalType !== "auto") return null
                    //     return {
                    //         title: "Evaluations",
                    //         key: "evaluations",
                    //         align: "left",
                    //         width: 200,
                    //         minWidth: 120,
                    //         render: (_: any, record: TableRow) => (
                    //             <EvaluationCell evaluationRunName={evaluationRunName} />
                    //         ),
                    //     }
                    case "status":
                        return {
                            ...common,
                            width: 100,
                            minWidth: 100,
                            render: (_: any, record: TableRow) => (
                                <StatusCell
                                    scenarioId={record.key as string}
                                    result={record.result}
                                />
                            ),
                        }
                    case "action":
                        if (evalType === "auto") return null
                        return {
                            ...common,
                            fixed: "right",
                            width: 120,
                            minWidth: 120,
                            render: (_: any, record: TableRow) => (
                                <ActionCell scenarioId={record.key} />
                            ),
                        }
                    default:
                        return {...common, dataIndex: c.path}
                }
            }

            // Group input columns under a parent "Inputs" column when evalType is 'auto' and there are multiple input columns
            if (c.kind === "input") {
                if (inputColumns.length > 0) {
                    if (c === inputColumns[0]) {
                        const isCollapsed = collapsed["inputs_group"]
                        return {
                            title: (
                                <span
                                    className="flex items-center gap-1 whitespace-nowrap"
                                    // onClick={(e) => {
                                    //     e.stopPropagation()
                                    //     toggle("inputs_group")
                                    // }}
                                >
                                    {/* {isCollapsed ? <RightOutlined /> : <DownOutlined />}  */}
                                    Inputs
                                </span>
                            ),
                            dataIndex: "inputs_group",
                            key: "inputs_group",
                            align: "left",
                            ...(isCollapsed
                                ? {
                                      // Render single cell with aggregated values when collapsed
                                      ...(() => {
                                          const childMax = maxChildWidth(inputColumns, distMap, 160)
                                          return {width: childMax, minWidth: childMax}
                                      })(),
                                      render: (_: any, record: TableRow) => (
                                          <div className="flex flex-col gap-2 group">
                                              <Expandable
                                                  expandKey={record.key}
                                                  disableExpand={!isCollapsed}
                                              >
                                                  {inputColumns.map((inputCol) => (
                                                      <div key={inputCol.key} className="text-wrap">
                                                          <span className="font-medium text-gray-500">
                                                              {titleCase(inputCol.name)}:
                                                          </span>{" "}
                                                          <InputCell
                                                              scenarioId={record.key}
                                                              stepKey={inputCol.stepKey}
                                                              inputKey={inputCol.path}
                                                              showEditor={false}
                                                              disableExpand={isCollapsed}
                                                          />
                                                      </div>
                                                  ))}
                                              </Expandable>
                                          </div>
                                      ),
                                  }
                                : {
                                      children: inputColumns.map((inputCol) => ({
                                          title: titleCase(inputCol.name),
                                          key: inputCol.key,
                                          render: (_: any, record: TableRow) => (
                                              <InputCell
                                                  scenarioId={record.key}
                                                  stepKey={inputCol.stepKey}
                                                  inputKey={inputCol.path}
                                              />
                                          ),
                                      })),
                                  }),
                        }
                    }
                    return null
                }
            }

            const sortable =
                (c.kind === "metric" || c.kind === "annotation") &&
                isSortableMetricType(c.metricType)

            const sorter = sortable ? scenarioMetricSorter(c) : undefined

            return {
                ...common,
                sorter,
                render: (_unused: any, record: TableRow) => {
                    // if (record.isSkeleton) return
                    switch (c.kind) {
                        case "input":
                            return (
                                <InputCell
                                    scenarioId={record.key}
                                    stepKey={c.stepKey}
                                    inputKey={c.path}
                                />
                            )
                        case "invocation":
                            return (
                                <InvocationResultCell
                                    isSkeleton={record.isSkeleton}
                                    scenarioId={record.key}
                                    stepKey={c.stepKey}
                                    path={c.path}
                                />
                            )
                        case "annotation":
                            return (
                                <AnnotationValueCell
                                    scenarioId={record.key}
                                    fieldPath={c.path}
                                    metricKey={c.name}
                                    metricType={c.metricType}
                                    fullKey={c.path}
                                    distInfo={distMap[c.path]}
                                    stepKey={c.stepKey}
                                    name={c.name}
                                />
                            )
                        case "metric":
                            return (
                                <MetricValueCell
                                    scenarioId={record.key}
                                    metricKey={c.path}
                                    fullKey={c.path}
                                    distInfo={distMap[c.path]}
                                    metricType={c.metricType}
                                    evalType={evalType!}
                                />
                            )
                        default:
                            return record.isSkeleton ? (
                                <SkeletonCell />
                            ) : (
                                (c.values?.[record.key] ?? "")
                            )
                    }
                },
            }
        })
        .filter(Boolean)
        .sort((a, b) => {
            const r = orderRank(a) - orderRank(b)
            if (r !== 0) return r
            return a.name?.localeCompare(b.name)
        }) as ColumnsType<TableRow>
}
