import {useCallback, useMemo, useState} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {message} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import {getColumns} from "@/oss/components/HumanEvaluations/assets/utils"
import {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {EvaluationType} from "@/oss/lib/enums"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"
import {EvaluationStatus} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"

import {buildAppScopedUrl, buildEvaluationNavigationUrl, extractEvaluationAppId} from "../utils"

import AutoEvaluationHeader from "./assets/AutoEvaluationHeader"

interface AutoEvaluationProps {
    viewType?: "overview" | "evaluation"
    scope?: "app" | "project"
}

const AutoEvaluation = ({viewType = "evaluation", scope = "app"}: AutoEvaluationProps) => {
    const routeAppId = useAppId()
    const activeAppId = scope === "app" ? routeAppId || undefined : undefined
    const router = useRouter()
    const {baseAppURL, projectURL} = useURL()

    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const [selectedEvalRecord, setSelectedEvalRecord] = useState<EvaluationRow>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeletingEvaluations, setIsDeletingEvaluations] = useState(false)
    const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
    const [tempEvaluation, setTempEvaluation] = useAtom(tempEvaluationAtom)
    const {apps: availableApps = []} = useAppsData()

    const {
        mergedEvaluations: _mergedEvaluations,
        isLoadingPreview,
        isLoadingLegacy,
        refetch,
        handleDeleteEvaluations: deleteEvaluations,
        previewEvaluations,
    } = useEvaluations({
        withPreview: true,
        types: [EvaluationType.automatic, EvaluationType.auto_exact_match],
        evalType: "auto",
        appId: activeAppId,
    })

    const previewAutoEvals = useMemo(() => {
        const evals = previewEvaluations.swrData?.data?.runs || []
        if (!evals.length) return []

        return evals?.filter((run) =>
            run?.data?.steps.every(
                (step) => step?.type !== "annotation" || step?.origin === "auto",
            ),
        )
    }, [previewEvaluations])

    const mergedEvaluations = useMemo(() => {
        const mergedIds = new Set(_mergedEvaluations?.map((e) => e.id))
        const filteredTempEvals = tempEvaluation.filter((e) => !mergedIds.has(e.id))
        return [..._mergedEvaluations, ...filteredTempEvals]
    }, [_mergedEvaluations, tempEvaluation])

    const runIds = useMemo(() => {
        return mergedEvaluations
            .map((evaluation) => {
                const candidate = "id" in evaluation ? evaluation.id : evaluation.key
                return typeof candidate === "string" ? candidate.trim() : undefined
            })
            .filter((id): id is string => Boolean(id && id.length > 0))
    }, [mergedEvaluations])
    const evaluatorSlugs = useMemo(() => {
        const evaSlugs = new Set<string>()
        previewAutoEvals.forEach((e) => {
            const key = e?.data.steps?.find((step) => step.type === "annotation")?.key
            if (key) evaSlugs.add(key)
        })
        return evaSlugs
    }, [previewAutoEvals])

    const {data: runMetricsMap} = useRunMetricsMap(runIds, evaluatorSlugs)

    const resolveAppId = useCallback(
        (record: EvaluationRow): string | undefined => {
            const candidate = extractEvaluationAppId(record) || activeAppId
            return candidate
        },
        [activeAppId],
    )

    const isRecordNavigable = useCallback(
        (record: EvaluationRow): boolean => {
            const status = record.status?.value || record.status
            const evaluationId = "id" in record ? record.id : record.key
            const recordAppId = resolveAppId(record)
            const isActionableStatus = ![
                EvaluationStatus.PENDING,
                EvaluationStatus.RUNNING,
                EvaluationStatus.CANCELLED,
                EvaluationStatus.INITIALIZED,
            ].includes(status)
            return Boolean(isActionableStatus && evaluationId && recordAppId)
        },
        [resolveAppId],
    )

    const handleVariantNavigation = useCallback(
        ({revisionId, appId: recordAppId}: {revisionId: string; appId?: string}) => {
            const targetAppId = recordAppId || activeAppId
            if (!targetAppId) {
                message.warning("This application's variant is no longer available.")
                return
            }

            router.push({
                pathname: buildAppScopedUrl(baseAppURL, targetAppId, "/playground"),
                query: {
                    revisions: buildRevisionsQueryParam([revisionId]),
                },
            })
        },
        [activeAppId, baseAppURL, router],
    )

    const handleDelete = useCallback(
        async (ids: string[]) => {
            setIsDeletingEvaluations(true)
            try {
                await deleteEvaluations(ids)
                message.success(
                    ids.length > 1 ? `${ids.length} Evaluations Deleted` : "Evaluation Deleted",
                )
                refetch()
            } catch (err) {
                message.error("Failed to delete evaluations")
                console.error(err)
            } finally {
                setTempEvaluation((prev) =>
                    prev.length > 0 ? prev.filter((e) => !ids.includes(e?.id)) : [],
                )
                setIsDeletingEvaluations(false)
                setIsDeleteEvalModalOpen(false)
                setSelectedRowKeys([])
            }
        },
        [refetch, deleteEvaluations],
    )

    const _columns: ColumnsType<EvaluationRow> = useMemo(() => {
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
            resolveAppId,
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
        resolveAppId,
    ])

    const visibleColumns = useMemo(
        () => filterColumns(_columns, hiddenColumns),
        [_columns, hiddenColumns],
    )

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
                  .map((e) => ("name" in e ? e.name : e.id))
                  .join(" | ")
    }, [selectedEvalRecord, selectedRowKeys, mergedEvaluations])

    const dataSource = useMemo(() => {
        return viewType === "overview" ? mergedEvaluations.slice(0, 5) : mergedEvaluations
    }, [mergedEvaluations, viewType])

    return (
        <section className="flex flex-col gap-2 pb-4">
            <AutoEvaluationHeader
                viewType={viewType}
                selectedRowKeys={selectedRowKeys}
                evaluations={mergedEvaluations}
                columns={_columns}
                setHiddenColumns={setHiddenColumns}
                setSelectedRowKeys={setSelectedRowKeys}
                selectedEvalRecord={selectedEvalRecord!}
                setIsDeleteEvalModalOpen={setIsDeleteEvalModalOpen}
                runMetricsMap={runMetricsMap}
                refetch={refetch}
                scope={scope}
                baseAppURL={baseAppURL}
                projectURL={projectURL}
                activeAppId={activeAppId}
                extractAppId={extractEvaluationAppId}
            />
            <EnhancedTable
                uniqueKey="auto-evaluations"
                loading={
                    isLoadingPreview ||
                    isLoadingLegacy ||
                    (previewAutoEvals?.length > 0 && !mergedEvaluations?.length)
                }
                rowSelection={
                    viewType === "evaluation"
                        ? {
                              type: "checkbox",
                              columnWidth: 48,
                              selectedRowKeys,
                              onChange: (selectedRowKeys: React.Key[]) => {
                                  setSelectedRowKeys(selectedRowKeys)
                              },
                              getCheckboxProps: (record: EvaluationRow) => ({
                                  disabled: !isRecordNavigable(record),
                              }),
                          }
                        : undefined
                }
                className="ph-no-capture"
                showHorizontalScrollBar={true}
                columns={visibleColumns}
                rowKey={(record: any) => ("id" in record ? record.id : record.key)}
                dataSource={dataSource}
                tableLayout="fixed"
                virtualized
                onRow={(record) => {
                    const navigable = isRecordNavigable(record)
                    const recordAppId = resolveAppId(record)
                    const evaluationId = "id" in record ? record.id : record.key
                    return {
                        style: {
                            cursor: navigable ? "pointer" : "not-allowed",
                        },
                        className: navigable ? undefined : "cursor-not-allowed opacity-60",
                        onClick: () => {
                            if (!navigable || !recordAppId || !evaluationId) {
                                message.warning(
                                    "This evaluation's application is no longer available.",
                                )
                                return
                            }

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
                    }
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
                        ? [selectedEvalRecord.id]
                        : selectedRowKeys.map((key) => key?.toString())
                    await handleDelete(idsToDelete.filter(Boolean))
                }}
                evaluationType={selectedEvaluations}
                isMultiple={!selectedEvalRecord && selectedRowKeys.length > 0}
            />
        </section>
    )
}

export default AutoEvaluation
