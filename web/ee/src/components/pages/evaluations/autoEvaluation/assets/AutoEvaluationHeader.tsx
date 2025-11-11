import {memo, useCallback, useMemo, useState} from "react"

import {ArrowsLeftRight, Export, Gauge, Plus, Trash} from "@phosphor-icons/react"
import {Button, Space, Input, message, theme, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"

import EditColumns from "@/oss/components/Filters/EditColumns"
import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {formatDate24, formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {getTypedValue} from "@/oss/lib/helpers/evaluate"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {variantNameWithRev} from "@/oss/lib/helpers/variantHelper"
import {searchQueryAtom} from "@/oss/lib/hooks/usePreviewEvaluations/states/queryFilterAtoms"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"
import {getMetricConfig} from "@/oss/lib/metrics/utils"
import {EvaluationStatus} from "@/oss/lib/Types"
import {getAppValues} from "@/oss/state/app"

import {statusMapper} from "../../../evaluations/cellRenderers/cellRenderers"
import {useStyles} from "../assets/styles"
import EvaluatorsModal from "../EvaluatorsModal/EvaluatorsModal"

import {buildAppScopedUrl, buildEvaluationNavigationUrl} from "../../utils"
import {AutoEvaluationHeaderProps} from "./types"

const isLegacyEvaluation = (evaluation: any): boolean => "aggregated_results" in evaluation

const getEvaluationKey = (evaluation: any): string | undefined =>
    (evaluation?.id ?? evaluation?.key)?.toString()

const disallowedCompareStatuses = new Set<EvaluationStatus | string>([
    EvaluationStatus.RUNNING,
    EvaluationStatus.PENDING,
    EvaluationStatus.CANCELLED,
    EvaluationStatus.INITIALIZED,
    EvaluationStatus.STARTED,
])

const NewEvaluationModal = dynamic(() => import("../../NewEvaluation"), {
    ssr: false,
})

const AutoEvaluationHeader = ({
    selectedRowKeys,
    evaluations,
    columns,
    setSelectedRowKeys,
    setHiddenColumns,
    setIsDeleteEvalModalOpen,
    viewType,
    runMetricsMap,
    refetch,
    scope,
    baseAppURL,
    projectURL,
    activeAppId,
    extractAppId,
}: AutoEvaluationHeaderProps) => {
    const classes = useStyles()
    const router = useRouter()

    const {token} = theme.useToken()
    const {appURL} = useURL()
    // atoms
    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
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
            const selectedKeySet = new Set(selectedRowKeys.map((key) => key?.toString()))
            const exportEvals = evaluations.filter((evaluation) => {
                const key = getEvaluationKey(evaluation)
                return key ? selectedKeySet.has(key) : false
            })
            if (!exportEvals.length) return

            const legacyEvals = exportEvals.filter((e) => "aggregated_results" in e)
            const newEvals = exportEvals.filter((e) => "name" in e)

            const {currentApp} = getAppValues()
            const filenameBase =
                currentApp?.app_name || (scope === "project" ? "all_applications" : "evaluations")
            const filename = `${filenameBase.replace(/\s+/g, "_")}_evaluation_scenarios.csv`

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
    }, [evaluations, selectedRowKeys, runMetricsMap, scope])

    const onSearch = useCallback(
        (text: string) => {
            if (!text && !searchQuery) return
            if (text === searchQuery) return

            setSearchQuery(text)
        },
        [searchQuery],
    )

    const selectedEvaluations = useMemo(() => {
        if (!selectedRowKeys.length) return []
        const selectedSet = new Set(selectedRowKeys.map((key) => key?.toString()))

        return evaluations.filter((evaluation: any) => {
            const key = getEvaluationKey(evaluation)
            return key ? selectedSet.has(key) : false
        })
    }, [evaluations, selectedRowKeys])

    const selectedAppId = useMemo(() => {
        const ids = (selectedEvaluations as EvaluationRow[])
            .map((evaluation) => extractAppId(evaluation))
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        const uniqueIds = Array.from(new Set(ids))
        const commonId = uniqueIds.length === 1 ? uniqueIds[0] : undefined
        return commonId || activeAppId
    }, [selectedEvaluations, activeAppId, extractAppId])

    const selectionType = useMemo(() => {
        if (!selectedEvaluations.length) return "none"

        const hasLegacy = selectedEvaluations.some((evaluation) => isLegacyEvaluation(evaluation))
        const hasModern = selectedEvaluations.some((evaluation) => !isLegacyEvaluation(evaluation))

        if (hasLegacy && hasModern) return "mixed"
        if (hasLegacy) return "legacy"
        return "modern"
    }, [selectedEvaluations])

    const legacySelections = useMemo(
        () => selectedEvaluations.filter((evaluation) => isLegacyEvaluation(evaluation)),
        [selectedEvaluations],
    )

    const modernSelections = useMemo(
        () => selectedEvaluations.filter((evaluation) => !isLegacyEvaluation(evaluation)),
        [selectedEvaluations],
    )

    const legacyCompareDisabled = useMemo(() => {
        if (selectionType !== "legacy") return true
        if (scope === "app" && !selectedAppId) return true
        if (legacySelections.length < 2) return true

        const [first] = legacySelections

        return legacySelections.some((item: any) => {
            const status = item.status?.value as EvaluationStatus
            return (
                status === EvaluationStatus.STARTED ||
                status === EvaluationStatus.INITIALIZED ||
                item.testset?.id !== first?.testset?.id
            )
        })
    }, [selectionType, selectedAppId, scope, legacySelections])

    const modernCompareDisabled = useMemo(() => {
        if (selectionType !== "modern") return true
        if (!selectedEvaluations.length) return true
        // users can compare up to 5 evals at a time
        if (selectedEvaluations.length > 5) return true
        if (scope === "app" && !selectedAppId) return true
        if (modernSelections.length < 2) return true

        const [first] = modernSelections
        const baseTestsetId = first?.testsets?.[0]?.id
        if (!baseTestsetId) return true

        if (process.env.NODE_ENV !== "production") {
            console.debug("[AutoEvaluationHeader] modern compare check", {
                scope,
                selectedAppId,
                baseTestsetId,
                selectionCount: modernSelections.length,
                statusList: modernSelections.map((run: any) => run?.status ?? run?.status?.value),
                testsetIds: modernSelections.map((run: any) => run?.testsets?.[0]?.id),
            })
        }

        return modernSelections.some((run: any) => {
            const status = (run?.status?.value ?? run?.status) as EvaluationStatus | string
            const testsetId = run?.testsets?.[0]?.id

            return (
                !testsetId ||
                testsetId !== baseTestsetId ||
                (status && disallowedCompareStatuses.has(status))
            )
        })
    }, [selectionType, selectedEvaluations, selectedAppId, scope, modernSelections])

    const compareDisabled = useMemo(() => {
        if (selectionType === "legacy") return legacyCompareDisabled
        if (selectionType === "modern") return modernCompareDisabled
        return true
    }, [selectionType, legacyCompareDisabled, modernCompareDisabled])

    const handleCompare = useCallback(() => {
        if (compareDisabled) return
        const selectedCommonAppId = selectedAppId
        if (process.env.NODE_ENV !== "production") {
            console.debug("[AutoEvaluationHeader] handleCompare invoked", {
                scope,
                selectionType,
                selectedCommonAppId,
                selectedCount: selectedEvaluations.length,
                selectedIds: selectedRowKeys,
            })
        }

        if (selectionType === "legacy") {
            const legacyIds = selectedEvaluations
                .filter((evaluation) => isLegacyEvaluation(evaluation))
                .map((evaluation: any) => evaluation.id)

            if (!legacyIds.length) return

            const primaryLegacyAppId =
                selectedCommonAppId ||
                (legacySelections[0] ? extractAppId(legacySelections[0]) : undefined)
            if (scope === "app" && !primaryLegacyAppId) return

            const pathname = buildEvaluationNavigationUrl({
                scope,
                baseAppURL,
                projectURL,
                appId: primaryLegacyAppId,
                path: "/evaluations/results/compare",
            })

            router.push({
                pathname,
                query: {
                    evaluations: legacyIds.join(","),
                    ...(scope === "project" && primaryLegacyAppId
                        ? {app_id: primaryLegacyAppId}
                        : {}),
                },
            })
            return
        }

        if (selectionType === "modern") {
            const modernSelectionSet = new Set(
                selectedEvaluations
                    .filter((evaluation) => !isLegacyEvaluation(evaluation))
                    .map((evaluation: any) => evaluation.id?.toString()),
            )
            const modernIds = selectedRowKeys
                .map((key) => key?.toString())
                .filter((id) => (id ? modernSelectionSet.has(id) : false))
            const [baseId, ...compareIds] = modernIds
            if (!baseId) return

            const baseRun =
                modernSelections.find((evaluation) => getEvaluationKey(evaluation) === baseId) ||
                undefined
            const baseAppId = baseRun ? extractAppId(baseRun) : undefined
            const effectiveAppId = selectedCommonAppId || baseAppId
            if (process.env.NODE_ENV !== "production") {
                console.debug("[AutoEvaluationHeader] navigating to compare view", {
                    baseId,
                    compareIds,
                    baseAppId,
                    selectedCommonAppId,
                    effectiveAppId,
                })
            }
            if (scope === "app" && !effectiveAppId) return

            const pathname = buildEvaluationNavigationUrl({
                scope,
                baseAppURL,
                projectURL,
                appId: effectiveAppId,
                path: `/evaluations/results/${baseId}`,
            })

            router.push({
                pathname,
                query: {
                    ...(compareIds.length ? {compare: compareIds} : {}),
                    ...(scope === "project" && effectiveAppId ? {app_id: effectiveAppId} : {}),
                },
            })
        }
    }, [
        compareDisabled,
        selectionType,
        selectedEvaluations,
        router,
        baseAppURL,
        projectURL,
        selectedRowKeys,
        scope,
        extractAppId,
        modernSelections,
        legacySelections,
        selectedAppId,
    ])

    return (
        <section className="flex flex-col gap-2">
            {viewType === "overview" ? (
                <div className="w-full flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Typography.Text className="font-medium">
                            Automatic Evaluation
                        </Typography.Text>
                        {(() => {
                            const href =
                                scope === "app"
                                    ? appURL
                                        ? `${appURL}/evaluations?selectedEvaluation=auto_evaluation`
                                        : undefined
                                    : `${projectURL}/evaluations?selectedEvaluation=auto_evaluation`
                            if (!href) return null
                            return (
                                <Link href={href}>
                                    <Button>View All</Button>
                                </Link>
                            )
                        })()}
                    </div>
                    {(scope === "app" || scope === "project") && (
                        <Button
                            icon={<Plus size={14} />}
                            className={classes.button}
                            onClick={() => setNewEvalModalOpen(true)}
                        >
                            Create new
                        </Button>
                    )}
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <Space>
                            {(scope === "app" && activeAppId) || scope === "project" ? (
                                <>
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
                                </>
                            ) : null}
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
                            <Button
                                type="text"
                                icon={<ArrowsLeftRight size={14} />}
                                className={classes.button}
                                disabled={compareDisabled}
                                onClick={handleCompare}
                            >
                                Compare
                            </Button>

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

            {(scope === "app" && activeAppId) || scope === "project" ? (
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

                        refetch()
                        setNewEvalModalOpen(false)
                    }}
                    evaluationType="auto"
                    preview={false}
                />
            ) : null}
        </section>
    )
}

export default memo(AutoEvaluationHeader)
