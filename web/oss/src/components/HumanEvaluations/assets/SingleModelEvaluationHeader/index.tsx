import {useCallback, useEffect, useMemo, useState, memo} from "react"

import {Export, Plus, Trash} from "@phosphor-icons/react"
import {Button, message, Space, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useSWRConfig} from "swr"

import {statusMapper} from "@/oss/components/pages/evaluations/cellRenderers/cellRenderers"
import useURL from "@/oss/hooks/useURL"
import {EvaluationType} from "@/oss/lib/enums"
import {calculateAvgScore} from "@/oss/lib/helpers/evaluate"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {getEvaluationRunScenariosKey} from "@/oss/lib/hooks/useEvaluationRunScenarios"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {summarizeMetric} from "@/oss/lib/metricUtils"
import {EvaluationStatus} from "@/oss/lib/Types"
import {getAppValues} from "@/oss/state/app"

import {SingleModelEvaluationHeaderProps} from "../../types"
import {EvaluationRow} from "../../types"
import {useStyles} from "../styles"
import {extractEvaluationStatus, getMetricSummaryValue} from "../utils"

const NewEvaluationModal = dynamic(
    () => import("@agenta/oss/src/components/pages/evaluations/NewEvaluation"),
    {
        ssr: false,
    },
)
const DeleteEvaluationModal = dynamic(
    () => import("@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"),
    {ssr: false},
)

const SingleModelEvaluationHeader = ({
    viewType,
    selectedRowKeys,
    mergedEvaluations,
    runMetricsMap,
    setSelectedRowKeys,
    isDeleteEvalModalOpen,
    setIsDeleteEvalModalOpen,
    selectedEvalRecord,
    setSelectedEvalRecord,
    scope,
    projectURL,
    activeAppId,
    extractAppId,
}: SingleModelEvaluationHeaderProps) => {
    const classes = useStyles()
    const {appURL} = useURL()
    const {cache} = useSWRConfig()
    const {refetch, handleDeleteEvaluations: deleteEvaluations} = useEvaluations({
        withPreview: true,
        types: [EvaluationType.single_model_test],
        appId: activeAppId,
    })

    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false)
    const [isDeletingEvaluations, setIsDeletingEvaluations] = useState(false)
    const [isScrolled, setIsScrolled] = useState(false)

    useEffect(() => {
        if (viewType === "overview") return

        const handleScroll = () => {
            setIsScrolled(window.scrollY > 180)
        }

        window.addEventListener("scroll", handleScroll)

        return () => {
            window.removeEventListener("scroll", handleScroll)
        }
    }, [viewType])

    const selectedEvaluations = useMemo(() => {
        return selectedEvalRecord
            ? (() => {
                  const found = mergedEvaluations.find(
                      (e) => ("id" in e ? e.id : e.key) === selectedEvalRecord?.id,
                  )
                  return found && "name" in found ? found.name : (found?.key ?? "")
              })()
            : mergedEvaluations
                  .filter((e) => selectedRowKeys.includes("id" in e ? e.id : e.key))
                  .map((e) => ("name" in e ? e.name : e.key))
                  .join(" | ")
    }, [selectedEvalRecord, selectedRowKeys])

    const handleDelete = useCallback(
        async (ids: string[]) => {
            setIsDeletingEvaluations(true)
            try {
                await deleteEvaluations(ids)
                message.success(
                    ids.length > 1 ? `${ids.length} Evaluations Deleted` : "Evaluation Deleted",
                )
            } catch (err) {
                message.error("Failed to delete evaluations")
                console.error(err)
            } finally {
                setIsDeletingEvaluations(false)
                setIsDeleteEvalModalOpen(false)
                setSelectedRowKeys([])
            }
        },
        [deleteEvaluations],
    )

    const runStatus = useCallback(
        (runId: string, status: EvaluationStatus, isLegacyEval: boolean) => {
            if (isLegacyEval) {
                const statusLabel = statusMapper({} as any)(status as EvaluationStatus)
                    .label as EvaluationStatus
                return statusLabel
            }

            const key = `${getEvaluationRunScenariosKey(runId)}-false`
            const cachedData = cache.get(key)
            const scenarios = cachedData?.data?.scenarios

            const {runStatus: _status} = extractEvaluationStatus(scenarios, status)
            return _status == "success" ? "completed" : _status
        },
        [cache],
    )

    const onExport = useCallback(() => {
        const exportEvals = mergedEvaluations.filter((e) =>
            selectedRowKeys.some((selected) => selected === ("id" in e ? e.id : e.key)),
        )

        try {
            if (exportEvals.length) {
                const {currentApp} = getAppValues()
                const filenameBase =
                    currentApp?.app_name ||
                    (scope === "project" ? "all_applications" : "evaluations")
                const filename = `${filenameBase.replace(/\s+/g, "_")}_human_annotation.csv`

                const rows = exportEvals.map((item) => {
                    const id = "id" in item ? item.id : item.key
                    const metrics = runMetricsMap?.[id]
                    const applicationName = (item as any)?.variants?.[0]?.appName || "-"
                    const applicationId = extractAppId(item as EvaluationRow) || "-"

                    // Note: all the 'in' conditions here are for legacy eval
                    const row: Record<string, any> = {
                        Name: "name" in item ? item.name : item.key,
                        Variant: `${item.variants?.[0]?.variantName} v${"revisions" in item ? item.revisions?.[0] : item.variants?.[0]?.revision}`,
                        Testset:
                            "testset" in item
                                ? item.testset.name
                                : (item.testsets?.[0]?.name ?? ""),
                        Status:
                            runStatus(id, item.status, item.status.includes("EVALUATION")) || "",
                        // legacy eval
                        ...("resultsData" in item
                            ? {"Average score": `${calculateAvgScore(item) || 0}%`}
                            : {}),
                        ...((item as any).createdBy?.user?.username
                            ? {"Created by": (item as any).createdBy?.user?.username}
                            : {}),
                        "Created on": item.createdAt,
                    }

                    if (scope === "project") {
                        row.Application = applicationName
                        row["Application ID"] = applicationId
                    }

                    // Track metric keys consumed by evaluator loop so we don't duplicate
                    const consumedKeys = new Set<string>()

                    if ("evaluators" in item && Array.isArray(item.evaluators)) {
                        item.evaluators.forEach((ev: any) => {
                            const metricDefs =
                                ev.data?.service?.format?.properties?.outputs?.properties || {}
                            Object.entries(metricDefs).forEach(
                                ([metricKey, def]: [string, any]) => {
                                    const fullKey = `${ev.slug}.${metricKey}`
                                    consumedKeys.add(fullKey)
                                    const stat = metrics?.[fullKey]
                                    const value = summarizeMetric(stat, def?.type)
                                    row[`${ev.name} ${metricKey}`] =
                                        value !== undefined && value !== null ? value : "N/A"
                                },
                            )
                        })
                    }

                    if (metrics) {
                        Object.entries(metrics).forEach(([metricKey, stat]) => {
                            if (consumedKeys.has(metricKey)) return
                            const value = summarizeMetric(stat as any)
                            row[metricKey] = value !== undefined && value !== null ? value : "N/A"
                        })
                    }

                    return row
                })

                const headerSet = new Set<string>()
                rows.forEach((r) => Object.keys(r).forEach((h) => headerSet.add(h)))
                const headers = Array.from(headerSet)

                const csvData = convertToCsv(rows, headers)
                downloadCsv(csvData, filename)
                setSelectedRowKeys([])
            }
        } catch (error) {
            message.error("Failed to export results. Please try again later")
        }
    }, [mergedEvaluations, selectedRowKeys, runMetricsMap, scope, extractAppId])

    return (
        <>
            {viewType === "overview" ? (
                <section className="flex justify-between items-center gap-3">
                    <Space>
                        <Typography.Text className="font-medium">Human Annotation</Typography.Text>

                        {(() => {
                            const href =
                                scope === "app"
                                    ? appURL
                                        ? `${appURL}/evaluations?selectedEvaluation=human_annotation`
                                        : undefined
                                    : `${projectURL}/evaluations?selectedEvaluation=human_annotation`

                            if (!href) return null

                            return (
                                <Button>
                                    <Link href={href}>View all</Link>
                                </Button>
                            )
                        })()}
                    </Space>

                    {(scope === "app" && activeAppId) || scope === "project" ? (
                        <Button icon={<Plus />} onClick={() => setIsEvalModalOpen(true)}>
                            Create new
                        </Button>
                    ) : null}
                </section>
            ) : (
                <section
                    className={clsx([
                        "flex justify-between gap-3 transition-all duration-200 ease-linear",
                        {
                            "!flex-row sticky top-2 z-10 bg-white py-2 px-2 border border-solid border-gray-200 rounded-lg mx-2 shadow-md":
                                isScrolled,
                            "translate-y-0 opacity-100": isScrolled,
                        },
                    ])}
                >
                    {(scope === "app" && activeAppId) || scope === "project" ? (
                        <Button
                            type="primary"
                            icon={<Plus size={14} />}
                            className={classes.button}
                            onClick={() => setIsEvalModalOpen(true)}
                        >
                            Start new evaluation
                        </Button>
                    ) : null}

                    <Space>
                        <Button
                            danger
                            type="text"
                            icon={<Trash size={14} />}
                            className={classes.button}
                            onClick={() => setIsDeleteEvalModalOpen(true)}
                            disabled={!selectedRowKeys.length}
                        >
                            Delete
                        </Button>
                        <Button
                            type="text"
                            onClick={onExport}
                            icon={<Export size={14} className="mt-0.5" />}
                            className={classes.button}
                            disabled={!selectedRowKeys.length}
                        >
                            Export as CSV
                        </Button>
                    </Space>
                </section>
            )}

            {((scope === "app" && activeAppId) || scope === "project") && (
                <NewEvaluationModal
                    open={isEvalModalOpen}
                    onCancel={() => {
                        setIsEvalModalOpen(false)
                    }}
                    onSuccess={() => {
                        setIsEvalModalOpen(false)
                        refetch()
                    }}
                    preview={true}
                    evaluationType={"human"}
                />
            )}

            <DeleteEvaluationModal
                confirmLoading={isDeletingEvaluations}
                open={isDeleteEvalModalOpen}
                onCancel={() => {
                    setIsDeleteEvalModalOpen(false)
                    setSelectedEvalRecord(undefined)
                }}
                onOk={async () => {
                    const idsToDelete = selectedEvalRecord
                        ? [selectedEvalRecord.id]
                        : selectedRowKeys.map((key) => key?.toString())
                    await handleDelete(idsToDelete.filter(Boolean))
                }}
                evaluationType={selectedEvaluations}
                isMultiple={!selectedEvalRecord && selectedRowKeys.length > 0}
            />
        </>
    )
}

export default memo(SingleModelEvaluationHeader)
