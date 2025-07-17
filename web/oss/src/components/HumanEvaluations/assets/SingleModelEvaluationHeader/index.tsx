import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {Export, Plus, Trash} from "@phosphor-icons/react"
import {Button, message, Space, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import {useSWRConfig} from "swr"

import {statusMapper} from "@/oss/components/pages/evaluations/cellRenderers/cellRenderers"
import {getAppValues} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {EvaluationType} from "@/oss/lib/enums"
import {calculateAvgScore} from "@/oss/lib/helpers/evaluate"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {getEvaluationRunScenariosKey} from "@/oss/lib/hooks/useEvaluationRunScenarios"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {summarizeMetric} from "@/oss/lib/metricUtils"
import {EvaluationStatus} from "@/oss/lib/Types"

import {SingleModelEvaluationHeaderProps} from "../../types"
import {useStyles} from "../styles"
import {extractEvaluationStatus, getMetricSummaryValue} from "../utils"

const NewEvaluationModal = dynamic(() => import("../../../pages/evaluations/NewEvaluation"), {
    ssr: false,
})
const DeleteEvaluationModal = dynamic(
    () => import("../../../DeleteEvaluationModal/DeleteEvaluationModal"),
    {
        ssr: false,
    },
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
}: SingleModelEvaluationHeaderProps) => {
    const classes = useStyles()
    const appId = useAppId()
    const {cache} = useSWRConfig()
    const {refetch, handleDeleteEvaluations: deleteEvaluations} = useEvaluations({
        withPreview: true,
        types: [EvaluationType.single_model_test],
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
                const filename = `${currentApp?.app_name}_human_annotation.csv`

                const rows = exportEvals.map((item) => {
                    const id = "id" in item ? item.id : item.key
                    const metrics = runMetricsMap?.[id]

                    // Note: all the 'in' conditions here are for legacy eval
                    const row: Record<string, any> = {
                        Name: "name" in item ? item.name : item.key,
                        Variant: `${item.variants?.[0]?.variantName} v${"revisions" in item ? item.revisions?.[0] : item.variants?.[0]?.revision}`,
                        "Test set":
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
    }, [mergedEvaluations, selectedRowKeys, runMetricsMap])

    return (
        <>
            {viewType === "overview" ? (
                <section className="flex justify-between gap-3">
                    <Space>
                        <Typography.Title>Human Annotation</Typography.Title>

                        <Button
                            href={`/apps/${appId}/evaluations?selectedEvaluation=single_model_evaluation`}
                        >
                            View all
                        </Button>
                    </Space>

                    <Button icon={<Plus />} onClick={() => setIsEvalModalOpen(true)}>
                        Create new
                    </Button>
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
                    <Button
                        type="primary"
                        icon={<Plus size={14} />}
                        className={classes.button}
                        onClick={() => setIsEvalModalOpen(true)}
                    >
                        Start new evaluation
                    </Button>

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

            <DeleteEvaluationModal
                confirmLoading={isDeletingEvaluations}
                open={isDeleteEvalModalOpen}
                onCancel={() => setIsDeleteEvalModalOpen(false)}
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

export default SingleModelEvaluationHeader
