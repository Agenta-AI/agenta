import {useCallback, useMemo, useState} from "react"

import {Gauge, Plus} from "@phosphor-icons/react"
import {Button} from "antd"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import EditColumns from "@/oss/components/Filters/EditColumns"
import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import {getColumns} from "@/oss/components/HumanEvaluations/assets/utils"
import type {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import axios from "@/oss/lib/api/assets/axiosConfig"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"
import {getMetricConfig} from "@/oss/lib/metrics/utils"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import {EvaluationStatus} from "@/oss/lib/Types"
import {retrieveQueryRevision} from "@/oss/services/onlineEvaluations/api"
import {getProjectValues} from "@/oss/state/project"

import {GeneralAutoEvalMetricColumns} from "../../../../../../ee/src/components/EvalRunDetails/components/VirtualizedScenarioTable/assets/constants"
import EvaluationStatusCell from "../../../../../../ee/src/components/HumanEvaluations/assets/EvaluationStatusCell"
import {buildEvaluationNavigationUrl} from "../utils"

import OnlineEvaluationRowActions from "./components/OnlineEvaluationRowActions"
import QueryFiltersCell from "./components/QueryFiltersCell"
import useOnlineEvaluations from "./hooks/useOnlineEvaluations"
import OnlineEvaluationDrawer from "./OnlineEvaluationDrawer"

// A minimal Online Evaluations view that shows the table structure with a proper empty state
// until the Online evaluations data model and fetching are implemented.

interface OnlineEvaluationProps {
    viewType?: "overview" | "evaluation"
    scope?: "app" | "project"
}

const OnlineEvaluation = ({viewType = "evaluation", scope = "project"}: OnlineEvaluationProps) => {
    const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectedEvalRecord, setSelectedEvalRecord] = useState<EvaluationRow>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeletingEvaluations, setIsDeletingEvaluations] = useState(false)
    const {baseAppURL, projectURL} = useURL()
    const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)
    const routeAppId = useAppId()
    const activeAppId = scope === "app" ? routeAppId || undefined : undefined
    const {evaluations, isLoading, mutate, isValidating} = useOnlineEvaluations({
        appId: activeAppId,
        scope,
    })

    const {data: availableEvaluators = []} = useEvaluators({
        preview: true,
        queries: {is_human: false},
    })

    const evaluatorNameLookup = useMemo(() => {
        const map = new Map<string, string>()
        availableEvaluators.forEach((ev) => {
            if (!ev) return
            const label = (ev as any)?.name || (ev as any)?.label || ev.slug || ev.key
            const identifiers = [
                ev.id,
                ev.slug,
                ev.key,
                (ev as any)?.meta?.evaluator_key,
                (ev as any)?.meta?.key,
                (ev as any)?.meta?.slug,
            ]
            identifiers.forEach((identifier) => {
                if (typeof identifier === "string" && identifier.trim()) {
                    map.set(identifier, label || identifier)
                }
            })
        })
        return map
    }, [availableEvaluators])

    const runIds = useMemo(() => evaluations.map((e) => ("id" in e ? e.id : e.key)), [evaluations])
    const evaluatorSlugs = useMemo(() => {
        const evaSlugs = new Set<string>()
        evaluations.forEach((e) => {
            const ann = (e as any)?.data?.steps?.find((step: any) => step?.type === "annotation")
            const refs = ann?.references || {}
            const slug = refs?.evaluator?.slug || refs?.evaluator?.key || ann?.key || undefined
            if (typeof slug === "string" && slug.trim()) evaSlugs.add(slug)
        })
        return evaSlugs
    }, [evaluations])

    const {data: runMetricsMap} = useRunMetricsMap(runIds, evaluatorSlugs)

    const extractAppId = useCallback((evaluation: EvaluationRow) => {
        const meta = (evaluation as any)?.meta
        const config = meta?.configuration
        return config?.app_id ?? config?.appId ?? meta?.app_id ?? meta?.appId
    }, [])

    const ColumnsEvaluatorCell = ({record}: {record: any}) => {
        const annotationStep = (record?.data?.steps || []).find(
            (s: any) => s?.type === "annotation",
        )
        const refs = annotationStep?.references || {}
        const evaluatorSlug = refs?.evaluator?.slug || refs?.evaluator?.key
        const evaluatorId = refs?.evaluator?.id
        const evaluatorName = refs?.evaluator?.name
        const displayName = useMemo(() => {
            const list = (record?.evaluators || []) as any[]
            const match = list.find(
                (e) =>
                    e?.id === evaluatorId || e?.slug === evaluatorSlug || e?.key === evaluatorSlug,
            )
            if (match?.name && typeof match.name === "string") return match.name
            if (typeof evaluatorName === "string" && evaluatorName.trim()) return evaluatorName
            if (evaluatorSlug && evaluatorNameLookup.has(evaluatorSlug)) {
                return evaluatorNameLookup.get(evaluatorSlug) as string
            }
            if (evaluatorId && evaluatorNameLookup.has(evaluatorId)) {
                return evaluatorNameLookup.get(evaluatorId) as string
            }
            return evaluatorSlug || "Evaluator"
        }, [record, evaluatorId, evaluatorSlug, evaluatorName, evaluatorNameLookup])

        return (
            <div className="flex items-center gap-2">
                <span className="text-[#1D2939]">{displayName}</span>
            </div>
        )
    }

    const columns = useMemo(() => {
        // Reuse the shared columns builder, but remove app/variant/testset columns
        const base = getColumns({
            evaluations,
            onVariantNavigation: () => undefined,
            setSelectedEvalRecord,
            setIsDeleteEvalModalOpen,
            // Pass computed metrics to show evaluator metric columns
            runMetricsMap: runMetricsMap || {},
            evalType: "online",
            scope,
            baseAppURL,
            extractAppId,
            projectURL,
        })

        const disallowedKeys = new Set(["variants", "testsetName", "application"]) as Set<
            string | number
        >

        const pruned = (base as any[]).filter((col) => !disallowedKeys.has(col?.key))

        // Inject Online-only columns: Filters, Evaluator
        const filtersCol = {
            title: "Filters",
            key: "onlineFilters",
            dataIndex: "onlineFilters",
            width: 320,
            render: (_: any, record: any) => <QueryFiltersCell record={record} />,
        }
        const evaluatorCol = {
            title: "Evaluator",
            key: "onlineEvaluator",
            dataIndex: "onlineEvaluator",
            width: 220,
            render: (_: any, record: any) => <ColumnsEvaluatorCell record={record} />,
        }

        // Position them after the base filters/metadata columns if any; else prepend
        let finalCols = [
            // keep first existing id/name/date, then our custom cols
            ...(pruned.slice(0, 2) as any[]),
            filtersCol,
            evaluatorCol,
            ...pruned.slice(2),
        ]

        // Online-only: normalize status column (Queued vs Running vs Stopped)
        finalCols = finalCols.map((col: any) => {
            if (col?.key === "status") {
                return {
                    ...col,
                    render: (value: any, record: any) => {
                        const flagSources = [
                            (record as any)?.flags,
                            (record as any)?.data?.flags,
                            (record as any)?.meta?.flags,
                            (record as any)?.statusMeta,
                        ]

                        const getStatusString = (candidate: any): string => {
                            if (!candidate && candidate !== 0) return ""
                            if (typeof candidate === "string") return candidate
                            if (typeof candidate === "object") {
                                return (
                                    (candidate as any)?.value ||
                                    (candidate as any)?.status ||
                                    (candidate as any)?.state ||
                                    ""
                                )
                            }
                            return String(candidate)
                        }

                        const rawStatus =
                            getStatusString(value) ||
                            getStatusString((record as any)?.status) ||
                            getStatusString((record as any)?.data?.status)

                        const normalizedStatus = rawStatus.toLowerCase()

                        const isExplicitFalse = (val: any) =>
                            val === false || val === 0 || val === "false" || val === "0"
                        const isExplicitTrue = (val: any) =>
                            val === true || val === 1 || val === "true" || val === "1"

                        const isStoppedByFlags = flagSources.some((src) => {
                            if (!src || typeof src !== "object") return false
                            return (
                                isExplicitFalse((src as any).isActive) ||
                                isExplicitFalse((src as any).is_active) ||
                                isExplicitFalse((src as any).isLive) ||
                                isExplicitFalse((src as any).is_live) ||
                                isExplicitTrue((src as any).isStopped) ||
                                isExplicitTrue((src as any).is_stopped) ||
                                (typeof (src as any).state === "string" &&
                                    ((src as any).state as string).toLowerCase() === "stopped")
                            )
                        })

                        const normalizedStatusKey = normalizedStatus.replace(/[\s-]+/g, "_")

                        const stopStatusTokens = new Set([
                            EvaluationStatus.CANCELLED.toLowerCase(),
                            "canceled",
                            "stopped",
                            "halted",
                            "closed",
                        ])
                        const isStoppedStatus =
                            stopStatusTokens.has(normalizedStatus) ||
                            stopStatusTokens.has(normalizedStatusKey)

                        const errorStatusTokens = new Set([
                            EvaluationStatus.ERROR,
                            EvaluationStatus.ERRORS,
                            EvaluationStatus.FAILURE,
                            EvaluationStatus.FINISHED_WITH_ERRORS,
                            EvaluationStatus.AGGREGATION_FAILED,
                            "error",
                            "errors",
                            "some_errors",
                            "failure",
                            "failed",
                            "fail",
                            "timeout",
                            "terminated",
                            "launch_error",
                        ])
                        const statusHasErrors =
                            errorStatusTokens.has(
                                normalizedStatusKey as EvaluationStatus | string,
                            ) ||
                            errorStatusTokens.has(normalizedStatus as EvaluationStatus | string)

                        const adjustedStatus: EvaluationStatus = (() => {
                            if (isStoppedByFlags || isStoppedStatus)
                                return EvaluationStatus.CANCELLED
                            if (!normalizedStatusKey) return EvaluationStatus.RUNNING
                            if (statusHasErrors) return EvaluationStatus.ERRORS
                            return EvaluationStatus.RUNNING
                        })()

                        const runId = "id" in record ? record.id : record.key
                        return (
                            <EvaluationStatusCell
                                status={adjustedStatus}
                                runId={runId}
                                evalType={"auto"}
                                preferProvidedStatus
                                statusOverride={(currentStatus, token) => {
                                    if (currentStatus === EvaluationStatus.CANCELLED) {
                                        return {
                                            label: "Stopped",
                                            color: token.colorTextTertiary,
                                        }
                                    }
                                    if (
                                        [EvaluationStatus.ERRORS, EvaluationStatus.ERROR].includes(
                                            currentStatus,
                                        )
                                    ) {
                                        return {
                                            label: "Running",
                                            color: token.colorSuccess,
                                            tooltip: "Some scenarios failed",
                                        }
                                    }
                                    return {
                                        label: "Running",
                                        color: token.colorSuccess,
                                    }
                                }}
                            />
                        )
                    },
                }
            }
            return col
        })

        return finalCols.map((col) => {
            if (col.key === "key") {
                return {
                    ...col,
                    render: (_: any, record: EvaluationRow) => (
                        <OnlineEvaluationRowActions
                            record={record}
                            baseAppURL={baseAppURL}
                            projectURL={projectURL}
                            scope={scope}
                            extractAppId={extractAppId}
                            setSelectedEvalRecord={setSelectedEvalRecord}
                            setIsDeleteEvalModalOpen={setIsDeleteEvalModalOpen}
                            mutate={mutate}
                        />
                    ),
                }
            }
            return col
        })
    }, [
        evaluations,
        runMetricsMap,
        scope,
        baseAppURL,
        projectURL,
        extractAppId,
        setSelectedEvalRecord,
        setIsDeleteEvalModalOpen,
        mutate,
    ])
    const visibleColumns = useMemo(
        () => filterColumns(columns, hiddenColumns),
        [columns, hiddenColumns],
    )

    const router = useRouter()
    const dataSource = useMemo(
        () => (viewType === "overview" ? evaluations.slice(0, 5) : evaluations),
        [evaluations, viewType],
    )

    const handleExportCsv = useCallback(async () => {
        if (typeof window === "undefined") return
        const selected = evaluations.filter((e) => {
            const key = ("id" in e ? (e as any).id : (e as any).key) as string
            return selectedRowKeys.includes(key)
        })
        if (!selected.length) return
        // Build evaluator metric keys (per evaluator slug)
        const evalMetricKeyMap = new Map<string, {name: string; keys: Set<string>}>()
        selected.forEach((rec) => {
            const evaluators = (((rec as any)?.evaluators || []) as any[]).filter(Boolean)
            evaluators.forEach((ev) => {
                const slug = ev?.slug || ev?.key
                if (!slug) return
                const name = ev?.name || slug
                const metricsObj = ev?.data?.service?.format?.properties?.outputs?.properties || {}
                const keys = new Set(Object.keys(metricsObj))
                if (!evalMetricKeyMap.has(slug)) {
                    evalMetricKeyMap.set(slug, {name, keys})
                } else {
                    const entry = evalMetricKeyMap.get(slug)!
                    keys.forEach((k) => entry.keys.add(k))
                }
            })
        })

        // Build general run metric keys from constant used by table
        const generalMetricDefs = GeneralAutoEvalMetricColumns || []

        // CSV headers (flattened) matching visible table columns
        const headers: string[] = [
            "Name",
            "Filters",
            "Evaluator",
            "Status",
            "Created by",
            "Created on",
        ]

        // Add evaluator metric headers in stable order: by evaluator name then metric key
        const evalHeaderPairs: {slug: string; label: string; metricKey: string}[] = []
        Array.from(evalMetricKeyMap.entries())
            .sort((a, b) => a[1].name.localeCompare(b[1].name))
            .forEach(([slug, {name, keys}]) => {
                Array.from(keys)
                    .sort()
                    .forEach((metricKey) => {
                        const label = `${name}.${metricKey}`
                        evalHeaderPairs.push({slug, label, metricKey})
                        headers.push(label)
                    })
            })

        // Add general metrics (Invocation Metrics)
        const generalHeaderPairs: {label: string; canonicalKey: string; rawKey: string}[] = []
        generalMetricDefs.forEach((def) => {
            const canonicalKey = canonicalizeMetricKey(def.path)
            headers.push(def.name)
            generalHeaderPairs.push({label: def.name, canonicalKey, rawKey: def.path})
        })

        // Helper to pick primary value from metric object or simple value
        const pickPrimary = (metricKey: string, metric: any): string | number | undefined => {
            if (metric == null) return undefined
            if (typeof metric === "object") {
                const {primary} = getMetricConfig(metricKey)
                const v = metric?.[primary]
                return v == null ? undefined : v
            }
            return metric
        }

        // Preload Filters info per selected row (based on query reference)
        const filtersById: Record<string, string> = {}
        try {
            await Promise.all(
                selected.map(async (rec) => {
                    const id = ("id" in rec ? (rec as any).id : (rec as any).key) as string
                    const inputStep = ((rec as any)?.data?.steps || []).find(
                        (s: any) => s?.type === "input",
                    )
                    const qRefs = inputStep?.references || {}
                    const queryId = qRefs?.query?.id || qRefs?.queryId
                    if (!queryId) return
                    try {
                        const res = await retrieveQueryRevision({query_ref: {id: queryId}})
                        const revision = res?.query_revision
                        const filtering = revision?.data?.filtering
                        const windowing = revision?.data?.windowing
                        const oldest = windowing?.oldest
                        const newest = windowing?.newest
                        let historicalRangeLabel: string | undefined
                        if (oldest && newest) {
                            const oldestDate = dayjs(oldest)
                            const newestDate = dayjs(newest)
                            if (oldestDate.isValid() && newestDate.isValid()) {
                                const diffDays = Math.max(newestDate.diff(oldestDate, "day"), 0)
                                if (diffDays > 0 && diffDays <= 31) {
                                    historicalRangeLabel = `Historical: Last ${diffDays} day${diffDays === 1 ? "" : "s"}`
                                } else {
                                    historicalRangeLabel = `Historical: ${oldestDate.format("DD MMM YYYY")} – ${newestDate.format("DD MMM YYYY")}`
                                }
                            }
                        }
                        const base = filtering ? JSON.stringify(filtering) : ""
                        filtersById[id] = [base, historicalRangeLabel].filter(Boolean).join(" | ")
                    } catch {
                        // ignore per-row filter load errors
                    }
                }),
            )
        } catch {
            // ignore
        }

        const rows = selected.map((rec) => {
            const id = ("id" in rec ? (rec as any).id : (rec as any).key) as string
            const name = ("name" in rec ? (rec as any).name : id) as string
            const status = ((rec as any)?.status ?? (rec as any)?.data?.status ?? "") as string
            const createdOn = ((rec as any)?.createdAt ??
                (rec as any)?.data?.created_at ??
                "") as string
            const annotation = ((rec as any)?.data?.steps || []).find(
                (s: any) => s?.type === "annotation",
            )
            const refs = annotation?.references || {}
            const evaluatorSlug = refs?.evaluator?.slug || refs?.evaluator?.key || ""
            const evaluatorName = (() => {
                const list = ((rec as any)?.evaluators || []) as any[]
                const match = list.find(
                    (e) =>
                        e?.id === refs?.evaluator?.id ||
                        e?.slug === evaluatorSlug ||
                        e?.key === evaluatorSlug,
                )
                return (match?.name || evaluatorSlug || "") as string
            })()
            const createdBy = ((rec as any)?.createdBy?.user?.username ?? "") as string

            // Base fields
            const row: Record<string, any> = {
                Name: name,
                Filters: filtersById[id] || "",
                Evaluator: evaluatorName,
                Status: status,
                "Created by": createdBy,
                "Created on": createdOn,
            }

            const metrics = (runMetricsMap || ({} as any))[id] || {}

            // Evaluator metrics values
            evalHeaderPairs.forEach(({slug, label, metricKey}) => {
                // Try different key encodings
                const candidates = [
                    `${slug}.${metricKey}`,
                    metricKey,
                    `attributes.ag.data.outputs.${metricKey}`,
                ]
                let found: any
                for (const k of candidates) {
                    if (metrics[k] != null) {
                        found = metrics[k]
                        break
                    }
                }
                const canonical = canonicalizeMetricKey(`${slug}.${metricKey}`)
                row[label] = pickPrimary(canonical, found)
            })

            // General metrics values
            generalHeaderPairs.forEach(({label, canonicalKey, rawKey}) => {
                const tail = rawKey.split(".").slice(-1)[0]
                const candidates = [canonicalKey, rawKey, `attributes.ag.data.outputs.${tail}`]
                let found: any
                for (const k of candidates) {
                    if (metrics[k] != null) {
                        found = metrics[k]
                        break
                    }
                }
                row[label] = pickPrimary(canonicalKey, found)
            })

            return row
        })
        const escape = (v: unknown) => {
            const s = `${v ?? ""}`
            if (s.includes(",") || s.includes("\n") || s.includes('"')) {
                return '"' + s.replace(/"/g, '""') + '"'
            }
            return s
        }
        const csv = [
            headers.join(","),
            ...rows.map((r) => headers.map((h) => escape((r as any)[h])).join(",")),
        ].join("\n")
        const blob = new Blob([csv], {type: "text/csv;charset=utf-8;"})
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "online-evaluations.csv"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }, [evaluations, selectedRowKeys, extractAppId, runMetricsMap])

    const selectedEvaluations = useMemo(() => {
        return selectedEvalRecord
            ? (() => {
                  const targetId =
                      "id" in (selectedEvalRecord as any)
                          ? (selectedEvalRecord as any).id
                          : (selectedEvalRecord as any).key
                  const found = evaluations.find(
                      (e) => ("id" in e ? (e as any).id : (e as any).key) === targetId,
                  )
                  return (
                      (found && ("name" in found ? (found as any).name : (found as any).key)) || ""
                  )
              })()
            : evaluations
                  .filter((e) =>
                      selectedRowKeys.includes("id" in e ? (e as any).id : (e as any).key),
                  )
                  .map((e) => ("name" in e ? (e as any).name : "id" in e ? e.id : (e as any).key))
                  .join(" | ")
    }, [selectedEvalRecord, selectedRowKeys, evaluations])

    const handleDelete = useCallback(
        async (ids: string[]) => {
            setIsDeletingEvaluations(true)
            try {
                const {projectId} = getProjectValues()
                await axios.delete(`/preview/evaluations/runs/?project_id=${projectId}`, {
                    data: {run_ids: ids},
                })
                message.success(
                    ids.length > 1 ? `${ids.length} Evaluations Deleted` : "Evaluation Deleted",
                )
                await mutate()
            } catch (err) {
                message.error("Failed to delete evaluations")
            } finally {
                setIsDeletingEvaluations(false)
                setIsDeleteEvalModalOpen(false)
                setSelectedRowKeys([])
            }
        },
        [mutate],
    )

    return (
        <section className="flex flex-col gap-2 pb-4">
            {viewType === "evaluation" && (
                <>
                    {/* <div className="flex items-center justify-between"></div> */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2">
                                {((scope === "app" && activeAppId) || scope === "project") && (
                                    <>
                                        <Button
                                            type="primary"
                                            icon={<Plus size={14} />}
                                            onClick={() => setIsCreateDrawerOpen(true)}
                                        >
                                            Start new evaluation
                                        </Button>
                                        <Button
                                            icon={<Gauge size={14} className="mt-0.5" />}
                                            onClick={() =>
                                                router.push(
                                                    `${projectURL}/evaluators?tab=automatic`,
                                                )
                                            }
                                        >
                                            Configure evaluators
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                            <Button
                                danger
                                type="text"
                                onClick={() => setIsDeleteEvalModalOpen(true)}
                                disabled={!selectedRowKeys.length}
                            >
                                Delete
                            </Button>
                            <Button
                                type="text"
                                disabled={!selectedRowKeys.length}
                                onClick={handleExportCsv}
                            >
                                Export as CSV
                            </Button>
                            <EditColumns
                                columns={columns as any}
                                uniqueKey="online-evaluation-header-column"
                                onChange={(keys) => setHiddenColumns(keys)}
                            />
                        </div>
                    </div>
                </>
            )}
            <EnhancedTable
                uniqueKey="online-evaluations"
                rowSelection={
                    viewType === "evaluation"
                        ? {
                              type: "checkbox",
                              columnWidth: 48,
                              selectedRowKeys,
                              onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
                          }
                        : undefined
                }
                onRow={(record) => ({
                    style: {cursor: "pointer"},
                    onClick: () => {
                        const evaluationId = "id" in record ? record.id : record.key
                        // const recordAppId = extractEvaluationAppId(record) || activeAppId
                        if (!evaluationId) return

                        const pathname = buildEvaluationNavigationUrl({
                            scope,
                            baseAppURL,
                            projectURL,
                            // appId: recordAppId,
                            path: `/evaluations/results/${evaluationId}?type=online`,
                        })

                        router.push(pathname)
                    },
                })}
                className="ph-no-capture"
                columns={visibleColumns as any}
                rowKey={(record: any) => ("id" in record ? record.id : record.key)}
                dataSource={dataSource}
                tableLayout="fixed"
                virtualized
                loading={isLoading || isValidating}
            />
            <OnlineEvaluationDrawer
                open={isCreateDrawerOpen}
                onClose={() => setIsCreateDrawerOpen(false)}
                onCreate={() => {
                    void mutate()
                    setIsCreateDrawerOpen(false)
                }}
            />
            <DeleteEvaluationModal
                confirmLoading={isDeletingEvaluations}
                open={isDeleteEvalModalOpen}
                onCancel={() => {
                    setIsDeleteEvalModalOpen(false)
                    setSelectedEvalRecord(undefined)
                }}
                onOk={async () => {
                    const idsToDelete = selectedEvalRecord
                        ? [
                              ("id" in selectedEvalRecord
                                  ? (selectedEvalRecord as any).id
                                  : (selectedEvalRecord as any).key) as string,
                          ]
                        : selectedRowKeys.map((key) => key?.toString())
                    await handleDelete(idsToDelete.filter(Boolean) as string[])
                }}
                evaluationType={
                    selectedEvalRecord
                        ? ("name" in (selectedEvalRecord as any)
                              ? (selectedEvalRecord as any).name
                              : (selectedEvalRecord as any).key) || "Online evaluation"
                        : selectedEvaluations && selectedEvaluations.length > 0
                          ? selectedEvaluations
                          : "Online evaluation"
                }
                isMultiple={!selectedEvalRecord && selectedRowKeys.length > 0}
            />
        </section>
    )
}

export default OnlineEvaluation
