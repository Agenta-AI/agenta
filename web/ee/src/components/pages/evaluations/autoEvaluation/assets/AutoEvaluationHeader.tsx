import {memo, useCallback, useMemo, useState} from "react"
import dynamic from "next/dynamic"

import {ArrowsLeftRight, Export, Gauge, Plus, Trash} from "@phosphor-icons/react"
import {Button, Space, Pagination, Input, message, theme, Typography} from "antd"
import {ColumnsType} from "antd/es/table"

import {formatDate24, formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {getTypedValue} from "@/oss/lib/helpers/evaluate"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"

import {useAtom, useSetAtom} from "jotai"
import {
    paginationAtom,
    searchQueryAtom,
} from "@/oss/lib/hooks/usePreviewEvaluations/states/queryFilterAtoms"

import {useStyles} from "../assets/styles"
import EvaluatorsModal from "../EvaluatorsModal/EvaluatorsModal"
import EditColumns from "@/oss/components/Filters/EditColumns"
import {getAppValues} from "@/oss/contexts/app.context"
import {variantNameWithRev} from "@/oss/lib/helpers/variantHelper"
import {EvaluationStatus, GenericObject} from "@/oss/lib/Types"
import {statusMapper} from "../../../evaluations/cellRenderers/cellRenderers"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {useRouter} from "next/router"
import {useAppId} from "@/oss/hooks/useAppId"
import {AutoEvaluationHeaderProps} from "./types"
import Link from "next/link"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {getMetricConfig} from "@/oss/lib/metrics/utils"

const NewEvaluationModal = dynamic(() => import("../../NewEvaluation"), {
    ssr: false,
})

const AutoEvaluationHeader = ({
    selectedRowKeys,
    evaluations,
    columns,
    setSelectedRowKeys,
    setHiddenColumns,
    fetchEvaluations,
    setIsDeleteEvalModalOpen,
    viewType,
    runMetricsMap,
}: AutoEvaluationHeaderProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = useAppId()
    const {token} = theme.useToken()

    // atoms
    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
    const [pagination, setPagination] = useAtom(paginationAtom)
    const setTempEvaluation = useSetAtom(tempEvaluationAtom)

    // local states
    const [searchTerm, setSearchTerm] = useState("")
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [current, setCurrent] = useState(0)
    const [isConfigEvaluatorModalOpen, setIsConfigEvaluatorModalOpen] = useQueryParam(
        "configureEvaluatorModal",
        "",
    )

    const onExport = useCallback(() => {
        try {
            const exportEvals = evaluations.filter((e) =>
                selectedRowKeys.some((selected) => selected === e.id),
            )
            if (!exportEvals.length) return

            const legacyEvals = exportEvals.filter((e) => "aggregated_results" in e)
            const newEvals = exportEvals.filter((e) => "name" in e)

            const {currentApp} = getAppValues()
            const filename = `${currentApp?.app_name}_evaluation_scenarios.csv`

            const exportableEvals = []

            if (legacyEvals.length) {
                const legacyEvalsData = legacyEvals.map((item) => {
                    const record: Record<string, any> = {}

                    // 1. variant name
                    record.Variant = variantNameWithRev({
                        variant_name: item.variants[0].variantName ?? "",
                        revision: item.revisions?.[0],
                    })
                    // 2. testset name
                    record.Testset = item.testset?.name

                    // 3. status
                    record.Status = statusMapper(token)(
                        item.status?.value as EvaluationStatus,
                    ).label

                    // 4. aggregated results for legacy evals
                    item.aggregated_results?.forEach((result) => {
                        record[result.evaluator_config.name] = getTypedValue(result?.result)
                    })

                    // 5. avg latency legacy evals
                    record["Avg. Latency"] = getTypedValue(item?.average_latency)

                    // 6. total cost for legacy evals
                    record["Total Cost"] = getTypedValue(item?.average_cost)

                    // 7. created at
                    record["Created At"] = formatDate24(item?.created_at)

                    return record
                })

                exportableEvals.push(...legacyEvalsData)
            }

            if (newEvals.length) {
                const newEvalsData = newEvals.map((item) => {
                    // Instead of using a plain object, use a Map to maintain insertion order
                    const record = new Map<string, any>()

                    // Add properties in the desired order
                    record.set("Name", item.name)

                    // 1. variant name
                    record.set(
                        "Variant",
                        variantNameWithRev({
                            variant_name: item.variants[0].variantName ?? "",
                            revision: item.variants[0].revision,
                        }),
                    )

                    // 2. testset name
                    record.set("Testset", item.testsets?.[0]?.name)

                    // 3. status
                    record.set("Status", statusMapper(token)(item.status as EvaluationStatus).label)

                    // 5. evaluator metrics
                    // 5. metrics (evaluator and invocation)
                    const metrics = runMetricsMap?.[item.id] || {}
                    const evaluators = item.evaluators || []

                    // First, collect all metrics and sort them
                    const sortedMetrics = Object.entries(metrics).sort(([a], [b]) => {
                        // Evaluator metrics (with dots) come first
                        const aIsEvaluator = a.includes(".")
                        const bIsEvaluator = b.includes(".")

                        // If both are evaluator metrics, sort them alphabetically
                        if (aIsEvaluator && bIsEvaluator) {
                            return a.localeCompare(b)
                        }

                        // If one is evaluator and one is not, evaluator comes first
                        if (aIsEvaluator) return -1
                        if (bIsEvaluator) return 1

                        // Both are not evaluator metrics, sort them alphabetically
                        return a.localeCompare(b)
                    })

                    // Then process them in the sorted order
                    for (const [k, v] of sortedMetrics) {
                        if (k.includes(".")) {
                            // Handle evaluator metrics
                            const [evaluatorSlug, metricKey] = k.split(".")
                            const evaluator = evaluators.find((e: any) => e.slug === evaluatorSlug)
                            if (!evaluator) continue

                            const key = `${evaluator.name}.${metricKey}`

                            if (v.mean !== undefined) {
                                record.set(key, v.mean)
                            } else if (v.unique) {
                                const trueEntry = v?.frequency?.find((f: any) => f?.value === true)
                                const total = v?.count ?? 0
                                const pct = total ? ((trueEntry?.count ?? 0) / total) * 100 : 0
                                record.set(key, `${pct.toFixed(2)}%`)
                            }
                        } else {
                            // Handle invocation metrics
                            const key = formatColumnTitle(k)

                            if (v.mean !== undefined) {
                                const {primary: primaryKey, label} = getMetricConfig(k)
                                record.set(label || key, formatMetricValue(k, v?.[primaryKey]))
                            } else if (v.unique) {
                                const trueEntry = v?.frequency?.find((f: any) => f?.value === true)
                                const total = v?.count ?? 0
                                const pct = total ? ((trueEntry?.count ?? 0) / total) * 100 : 0
                                record.set(key, `${pct.toFixed(2)}%`)
                            }
                        }
                    }
                    // 6. created by
                    record.set("Created By", item?.createdBy?.user?.username)

                    // 7. created at
                    record.set("Created At", item?.createdAt)

                    return Object.fromEntries(record)
                })

                exportableEvals.push(...newEvalsData)
            }

            // Get all unique column keys
            const columnKeys = new Set<string>()
            exportableEvals.forEach((row) => {
                Object.keys(row).forEach((key) => columnKeys.add(key))
            })

            // Build ordered columns according to the desired export order
            const startColumns = ["Name", "Variant", "Testset", "Status"].filter((k) =>
                columnKeys.has(k),
            )
            const endColumns = ["Created By", "Created At"].filter((k) => columnKeys.has(k))

            // Evaluator metrics first (keys with a dot), sorted alphabetically for stability
            const evaluatorMetricColumns = Array.from(columnKeys)
                .filter((k) => k.includes("."))
                .sort((a, b) => a.localeCompare(b))

            // Remaining metrics/columns (excluding the above), sorted alphabetically
            const remainingColumns = Array.from(columnKeys)
                .filter(
                    (k) => !startColumns.includes(k) && !endColumns.includes(k) && !k.includes("."),
                )
                .sort((a, b) => a.localeCompare(b))

            const _columns = [
                ...startColumns,
                ...evaluatorMetricColumns,
                ...remainingColumns,
                ...endColumns,
            ]

            const csvData = convertToCsv(exportableEvals, _columns)
            downloadCsv(csvData, filename)
            message.success("Results exported successfully!")
        } catch (error) {
            message.error("Failed to export evaluations")
        }
    }, [evaluations, selectedRowKeys])

    const onSearch = useCallback(
        (text: string) => {
            if (!text && !searchQuery) return
            if (text === searchQuery) return

            setSearchQuery(text)
        },
        [searchQuery],
    )

    const compareDisabled = useMemo(() => {
        const legacyEvals = evaluations.filter((run) => "aggregated_results" in run)
        const evalList = legacyEvals.filter((e) => selectedRowKeys.includes(e.id))

        return (
            evalList.length < 2 ||
            evalList.some(
                (item) =>
                    item.status?.value === EvaluationStatus.STARTED ||
                    item.status?.value === EvaluationStatus.INITIALIZED ||
                    item.testset?.id !== evalList[0].testset?.id,
            )
        )
    }, [selectedRowKeys])

    return (
        <section className="flex flex-col gap-2">
            {viewType === "overview" ? (
                <div className="w-full flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Typography.Text className="font-medium">
                            Automatic Evaluation
                        </Typography.Text>
                        <Link
                            href={`/apps/${appId}/evaluations?selectedEvaluation=auto_evaluation`}
                        >
                            <Button>View All</Button>
                        </Link>
                    </div>
                    <Button
                        icon={<Plus size={14} />}
                        className={classes.button}
                        onClick={() => setNewEvalModalOpen(true)}
                    >
                        Create new
                    </Button>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <Space>
                            <Button
                                type="primary"
                                icon={<Plus size={14} />}
                                className={classes.button}
                                onClick={() => setNewEvalModalOpen(true)}
                            >
                                Start new evaluation
                            </Button>
                            <Button
                                icon={<Gauge size={14} className="mt-0.5" />}
                                className={classes.button}
                                onClick={() => {
                                    setIsConfigEvaluatorModalOpen("open")
                                    setCurrent(0)
                                }}
                            >
                                Configure evaluators
                            </Button>
                        </Space>
                        {/* <div className="flex items-center gap-2">
                            <Pagination
                                simple
                                total={evaluations.length}
                                current={pagination.page}
                                pageSize={pagination.size}
                                onChange={(p, s) => setPagination({page: p, size: s})}
                                className="flex items-center xl:hidden shrink-0 [&_.ant-pagination-options]:hidden lg:[&_.ant-pagination-options]:block [&_.ant-pagination-options]:!ml-2"
                            />
                            <Pagination
                                total={evaluations.length}
                                current={pagination.page}
                                pageSize={pagination.size}
                                onChange={(p, s) => setPagination({page: p, size: s})}
                                className="hidden xl:flex xl:items-center"
                            />
                        </div> */}
                    </div>

                    <div className="flex items-center justify-between">
                        <Input.Search
                            allowClear
                            placeholder="Search"
                            style={{width: 400}}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onClear={() => {
                                setSearchTerm("")
                                if (searchQuery) {
                                    setSearchQuery("")
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    onSearch(searchTerm)
                                }
                            }}
                        />
                        <div className="flex gap-2">
                            <Button
                                danger
                                type="text"
                                icon={<Trash size={14} />}
                                className={classes.button}
                                onClick={() => setIsDeleteEvalModalOpen(true)}
                                disabled={selectedRowKeys.length == 0}
                            >
                                Delete
                            </Button>
                            {!compareDisabled && (
                                <Button
                                    type="text"
                                    icon={<ArrowsLeftRight size={14} />}
                                    className={classes.button}
                                    onClick={() =>
                                        router.push(
                                            `/apps/${appId}/evaluations/results/compare?evaluations=${selectedRowKeys.join(",")}`,
                                        )
                                    }
                                >
                                    Compare
                                </Button>
                            )}

                            <Button
                                type="text"
                                onClick={onExport}
                                icon={<Export size={14} className="mt-0.5" />}
                                className={classes.button}
                                disabled={selectedRowKeys.length == 0}
                            >
                                Export as CSV
                            </Button>
                            <EditColumns
                                columns={columns as ColumnsType}
                                uniqueKey="auto-evaluation-header-column"
                                onChange={(keys) => {
                                    setHiddenColumns(keys)
                                }}
                            />
                        </div>
                    </div>

                    <EvaluatorsModal
                        open={isConfigEvaluatorModalOpen === "open"}
                        onCancel={() => setIsConfigEvaluatorModalOpen("")}
                        current={current}
                        setCurrent={setCurrent}
                    />
                </>
            )}

            <NewEvaluationModal
                open={newEvalModalOpen}
                onCancel={() => {
                    setNewEvalModalOpen(false)
                }}
                onSuccess={(res) => {
                    const runningEvaluations = res.data.runs || []
                    setTempEvaluation((prev) => {
                        const existingIds = new Set([
                            ...prev.map((e) => e.id),
                            ...evaluations.map((e) => e.id),
                        ])
                        const newEvaluations = runningEvaluations
                            .filter((e) => !existingIds.has(e.id))
                            .map((e) => {
                                const camelCase = snakeToCamelCaseKeys(e)
                                return {
                                    ...camelCase,
                                    data: {steps: [{origin: "auto", type: "annotation"}]},
                                    status: "running",
                                    createdAt: formatDay({
                                        date: camelCase.createdAt,
                                        outputFormat: "DD MMM YYYY | h:mm a",
                                    }),
                                    createdAtTimestamp: dayjs(
                                        camelCase.createdAt,
                                        "YYYY/MM/DD H:mm:ssAZ",
                                    ).valueOf(),
                                }
                            })

                        return [...prev, ...newEvaluations]
                    })

                    setNewEvalModalOpen(false)
                }}
                evaluationType="auto"
                preview={false}
            />
        </section>
    )
}

export default memo(AutoEvaluationHeader)
