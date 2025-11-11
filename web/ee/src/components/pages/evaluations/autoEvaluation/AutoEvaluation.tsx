import {useCallback, useEffect, useMemo, useState} from "react"

import {message} from "antd"
import {ColumnsType} from "antd/es/table"

import {useRouter} from "next/router"

import {useAppId} from "@/oss/hooks/useAppId"

import {EvaluationStatus} from "@/oss/lib/Types"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import {getColumns} from "@/oss/components/HumanEvaluations/assets/utils"
import {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import {EvaluationType} from "@/oss/lib/enums"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import AutoEvaluationHeader from "./assets/AutoEvaluationHeader"
import {useAtom} from "jotai"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"

const queryClient = new QueryClient()

const AutoEvaluation = ({viewType = "evaluation"}: {viewType?: "overview" | "evaluation"}) => {
    const appId = useAppId()
    const router = useRouter()

    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const [selectedEvalRecord, setSelectedEvalRecord] = useState<EvaluationRow>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeletingEvaluations, setIsDeletingEvaluations] = useState(false)
    const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
    const [tempEvaluation, setTempEvaluation] = useAtom(tempEvaluationAtom)

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

    const runIds = useMemo(
        () => mergedEvaluations.map((e) => ("id" in e ? e.id : e.key)),
        [mergedEvaluations],
    )
    const evaluatorSlugs = useMemo(() => {
        const evaSlugs = new Set<string>()
        previewAutoEvals.forEach((e) => {
            const key = e?.data.steps?.find((step) => step.type === "annotation")?.key
            if (key) evaSlugs.add(key)
        })
        return evaSlugs
    }, [previewAutoEvals])

    const {data: runMetricsMap} = useRunMetricsMap(runIds, evaluatorSlugs)

    const handleVariantNavigation = useCallback(
        (variantRevisionId: string) => {
            router.push({
                pathname: `/apps/${appId}/playground`,
                query: {
                    revisions: JSON.stringify([variantRevisionId]),
                },
            })
        },
        [appId],
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
        })
    }, [
        mergedEvaluations,
        handleVariantNavigation,
        setSelectedEvalRecord,
        setIsDeleteEvalModalOpen,
        runMetricsMap,
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
                          }
                        : undefined
                }
                className="ph-no-capture"
                columns={visibleColumns}
                rowKey={"id"}
                dataSource={dataSource}
                tableLayout="fixed"
                scroll={{x: "max-content"}}
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
                    onClick: () => {
                        const status = record.status?.value || record.status

                        if (
                            ![
                                EvaluationStatus.PENDING,
                                EvaluationStatus.RUNNING,
                                EvaluationStatus.CANCELLED,
                                EvaluationStatus.INITIALIZED,
                            ].includes(status)
                        ) {
                            router.push(`/apps/${appId}/evaluations/results/${record.id}`)
                        }
                    },
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

export default ({viewType}: {viewType: "overview" | "evaluation"}) => (
    <QueryClientProvider client={queryClient}>
        <AutoEvaluation viewType={viewType} />
    </QueryClientProvider>
)
