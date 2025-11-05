import {useCallback, useMemo, useState} from "react"

import {Button, message} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import EditColumns from "@/oss/components/Filters/EditColumns"
import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import {getColumns} from "@/oss/components/HumanEvaluations/assets/utils"
import type {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {EvaluationType} from "@/oss/lib/enums"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"
import {EvaluationStatus} from "@/oss/lib/Types"

import {buildAppScopedUrl, buildEvaluationNavigationUrl, extractEvaluationAppId} from "../utils"

interface CustomEvaluationProps {
    scope?: "app" | "project"
    viewType?: "overview" | "evaluation"
}

const isPreviewCustomRun = (run: any) => {
    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
    const hasCustomStep = steps.some(
        (step: any) =>
            step?.origin === "custom" ||
            step?.type === "custom" ||
            step?.metadata?.origin === "custom",
    )
    if (!hasCustomStep) return false

    const source = typeof run?.meta?.source === "string" ? run.meta.source.toLowerCase() : undefined
    const isOnlineSource = source === "online_evaluation_drawer"
    const isLive = Boolean(run?.flags?.is_live)

    return hasCustomStep && !isOnlineSource && !isLive
}

const CustomEvaluation = ({scope = "app", viewType = "evaluation"}: CustomEvaluationProps) => {
    const router = useRouter()
    const routeAppId = useAppId()
    const activeAppId = scope === "app" ? routeAppId || undefined : undefined
    const {baseAppURL, projectURL} = useURL()

    const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectedEvalRecord, setSelectedEvalRecord] = useState<EvaluationRow>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeletingEvaluations, setIsDeletingEvaluations] = useState(false)
    const [tempEvaluation, setTempEvaluation] = useAtom(tempEvaluationAtom)

    const {
        mergedEvaluations: mergedEvaluationsFromHook,
        previewEvaluations,
        isLoadingLegacy,
        isLoadingPreview,
        refetch,
        handleDeleteEvaluations: deleteEvaluations,
    } = useEvaluations({
        withPreview: true,
        types: [EvaluationType.custom_code_run],
        evalType: "custom",
        appId: activeAppId,
    })

    const previewRuns = useMemo(() => {
        const runs = previewEvaluations?.swrData?.data?.runs || []
        return runs.filter(isPreviewCustomRun)
    }, [previewEvaluations])

    const evaluatorSlugs = useMemo(() => {
        const slugs = new Set<string>()
        previewRuns.forEach((run: any) => {
            const annotationSteps = Array.isArray(run?.data?.steps)
                ? run.data.steps.filter((step: any) => step?.type === "annotation")
                : []
            annotationSteps.forEach((step: any) => {
                if (step?.key) slugs.add(step.key)
            })
        })
        return Array.from(slugs)
    }, [previewRuns])

    const mergedEvaluations = useMemo(() => {
        const mergedIds = new Set(mergedEvaluationsFromHook.map((e) => ("id" in e ? e.id : e.key)))
        const tempEntries = tempEvaluation.filter((evaluation) => !mergedIds.has(evaluation.id))
        return [...mergedEvaluationsFromHook, ...tempEntries]
    }, [mergedEvaluationsFromHook, tempEvaluation])

    const runIds = useMemo(
        () => mergedEvaluations.map((record) => ("id" in record ? record.id : record.key)),
        [mergedEvaluations],
    )

    const {data: runMetricsMap} = useRunMetricsMap(runIds, evaluatorSlugs)

    const handleVariantNavigation = useCallback(
        ({revisionId, appId}: {revisionId: string; appId?: string}) => {
            const targetAppId = appId || activeAppId
            if (!targetAppId) return
            const url = buildAppScopedUrl(baseAppURL, targetAppId, "/playground")
            router.push({
                pathname: url,
                query: {
                    revisions: buildRevisionsQueryParam([revisionId]),
                },
            })
        },
        [activeAppId, baseAppURL, router],
    )

    const columns: ColumnsType<EvaluationRow> = useMemo(() => {
        return getColumns({
            evaluations: mergedEvaluations,
            onVariantNavigation: handleVariantNavigation,
            setSelectedEvalRecord,
            setIsDeleteEvalModalOpen,
            runMetricsMap,
            evalType: "auto",
            scope,
            baseAppURL,
            extractAppId: extractEvaluationAppId,
            projectURL,
        })
    }, [
        mergedEvaluations,
        handleVariantNavigation,
        setSelectedEvalRecord,
        setIsDeleteEvalModalOpen,
        runMetricsMap,
        scope,
        baseAppURL,
        projectURL,
    ])

    const visibleColumns = useMemo(
        () => filterColumns(columns, hiddenColumns),
        [columns, hiddenColumns],
    )

    const handleDelete = useCallback(
        async (ids: string[]) => {
            setIsDeletingEvaluations(true)
            try {
                await deleteEvaluations(ids)
                message.success(
                    ids.length > 1 ? `${ids.length} evaluations deleted` : "Evaluation deleted",
                )
                await refetch()
            } catch (error) {
                message.error("Failed to delete evaluations")
                console.error("Failed to delete custom evaluations", error)
            } finally {
                setTempEvaluation((prev) =>
                    prev.length > 0
                        ? prev.filter((evaluation) => !ids.includes(evaluation?.id))
                        : [],
                )
                setIsDeletingEvaluations(false)
                setIsDeleteEvalModalOpen(false)
                setSelectedRowKeys([])
                setSelectedEvalRecord(undefined)
            }
        },
        [deleteEvaluations, refetch, setTempEvaluation],
    )

    const dataSource = useMemo(() => {
        return viewType === "overview" ? mergedEvaluations.slice(0, 5) : mergedEvaluations
    }, [mergedEvaluations, viewType])

    const selectedEvaluationsLabel = useMemo(() => {
        if (selectedEvalRecord) {
            return selectedEvalRecord.name ?? selectedEvalRecord.key
        }
        const selectedItems = mergedEvaluations.filter((evaluation) =>
            selectedRowKeys.includes("id" in evaluation ? evaluation.id : evaluation.key),
        )
        if (selectedItems.length === 0) return "Custom evaluation"
        return selectedItems.map((item) => ("name" in item ? item.name : item.key)).join(" | ")
    }, [selectedEvalRecord, selectedRowKeys, mergedEvaluations])

    const handleRowNavigation = useCallback(
        (record: EvaluationRow) => {
            const status = record.status?.value || record.status
            if (
                [
                    EvaluationStatus.PENDING,
                    EvaluationStatus.RUNNING,
                    EvaluationStatus.CANCELLED,
                    EvaluationStatus.INITIALIZED,
                ].includes(status as EvaluationStatus)
            ) {
                return
            }

            const evaluationId = "id" in record ? record.id : record.key
            const recordAppId = extractEvaluationAppId(record) || activeAppId
            if (!recordAppId || !evaluationId) return

            const targetPath = buildEvaluationNavigationUrl({
                scope,
                baseAppURL,
                projectURL,
                appId: recordAppId,
                path: `/evaluations/results/${evaluationId}`,
            })

            if (scope === "project") {
                router.push({
                    pathname: targetPath,
                    query: recordAppId ? {app_id: recordAppId} : undefined,
                })
            } else {
                router.push(targetPath)
            }
        },
        [activeAppId, scope, baseAppURL, projectURL, router],
    )

    return (
        <section className="flex flex-col gap-2 pb-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button
                        danger
                        disabled={
                            selectedRowKeys.length === 0 &&
                            (!selectedEvalRecord || !selectedEvalRecord.id)
                        }
                        onClick={() => setIsDeleteEvalModalOpen(true)}
                    >
                        Delete
                    </Button>
                </div>
                <EditColumns
                    columns={columns as any}
                    uniqueKey="custom-evaluations-table-columns"
                    onChange={(keys) => setHiddenColumns(keys)}
                />
            </div>

            <EnhancedTable
                uniqueKey="custom-evaluations"
                loading={isLoadingPreview || isLoadingLegacy}
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
                className="ph-no-capture"
                columns={visibleColumns as any}
                rowKey={(record: any) => ("id" in record ? record.id : record.key)}
                dataSource={dataSource}
                tableLayout="fixed"
                virtualized
                onRow={(record) => ({
                    style: {
                        cursor: ![
                            EvaluationStatus.PENDING,
                            EvaluationStatus.RUNNING,
                            EvaluationStatus.CANCELLED,
                            EvaluationStatus.INITIALIZED,
                        ].includes(record.status?.value || record.status)
                            ? "pointer"
                            : "not-allowed",
                    },
                    onClick: () => handleRowNavigation(record),
                })}
            />

            <DeleteEvaluationModal
                confirmLoading={isDeletingEvaluations}
                open={isDeleteEvalModalOpen}
                onCancel={() => {
                    setIsDeleteEvalModalOpen(false)
                    setSelectedEvalRecord(undefined)
                }}
                onOk={async () => {
                    const ids = selectedEvalRecord
                        ? [selectedEvalRecord.id]
                        : selectedRowKeys.map((key) => key?.toString()).filter(Boolean)
                    if (ids.length) {
                        await handleDelete(ids as string[])
                    }
                }}
                evaluationType={selectedEvaluationsLabel}
                isMultiple={!selectedEvalRecord && selectedRowKeys.length > 0}
            />
        </section>
    )
}

export default CustomEvaluation
