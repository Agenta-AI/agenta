import {memo, useMemo, useCallback, useState, type Key} from "react"

import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {useRouter} from "next/router"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {EvaluationType} from "@/oss/lib/enums"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"

import SingleModelEvaluationHeader from "./assets/SingleModelEvaluationHeader"
import {useStyles} from "./assets/styles"
import {getColumns} from "./assets/utils"
import {EvaluationRow} from "./types"

const SingleModelEvaluation = ({viewType}: {viewType: "evaluation" | "overview"}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const [selectedEvalRecord, setSelectedEvalRecord] = useState<EvaluationRow>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

    const {mergedEvaluations, isLoadingPreview, isLoadingLegacy} = useEvaluations({
        withPreview: true,
        types: [EvaluationType.single_model_test],
        evalType: "human",
    })

    const runIds = useMemo(
        () => mergedEvaluations.map((e) => ("id" in e ? e.id : e.key)),
        [mergedEvaluations],
    )
    const evaluatorSlugs = useMemo(() => {
        const evaSlugs = new Set<string>()
        mergedEvaluations.forEach((e) => {
            const key = e?.data.steps?.find((step) => step.type === "annotation")?.key
            if (key) evaSlugs.add(key)
        })
        return evaSlugs
    }, [mergedEvaluations])

    const {data: runMetricsMap} = useRunMetricsMap(runIds, evaluatorSlugs)

    const rowSelection = useMemo(() => {
        return {
            onChange: (selectedRowKeys: Key[]) => {
                setSelectedRowKeys(selectedRowKeys)
            },
        }
    }, [])

    const handleNavigation = useCallback(
        (revisionId: string) => {
            router.push({
                pathname: `/apps/${appId}/playground`,
                query: {
                    revisions: JSON.stringify([revisionId]),
                },
            })
        },
        [router, appId],
    )

    const columns: ColumnsType<EvaluationRow> = useMemo(() => {
        return getColumns({
            evaluations: mergedEvaluations,
            onVariantNavigation: handleNavigation,
            evalType: "human",
            setSelectedEvalRecord,
            setIsDeleteEvalModalOpen,
            runMetricsMap,
        })
    }, [
        mergedEvaluations,
        handleNavigation,
        setSelectedEvalRecord,
        setIsDeleteEvalModalOpen,
        runMetricsMap,
    ])

    const dataSource = useMemo(() => {
        return viewType === "overview" ? mergedEvaluations.slice(0, 5) : mergedEvaluations
    }, [viewType, mergedEvaluations])

    return (
        <div
            className={clsx(classes.container, "grow flex flex-col min-h-0 overflow-hidden", {
                "human-eval": viewType !== "overview",
            })}
        >
            <SingleModelEvaluationHeader
                viewType={viewType}
                selectedRowKeys={selectedRowKeys}
                mergedEvaluations={mergedEvaluations}
                runMetricsMap={runMetricsMap}
                setSelectedRowKeys={setSelectedRowKeys}
                isDeleteEvalModalOpen={isDeleteEvalModalOpen}
                setIsDeleteEvalModalOpen={setIsDeleteEvalModalOpen}
                selectedEvalRecord={selectedEvalRecord}
                setSelectedEvalRecord={setSelectedEvalRecord}
            />

            <div className="relative w-full h-full overflow-auto">
                <EnhancedTable
                    rowSelection={
                        viewType === "evaluation"
                            ? {
                                  type: "checkbox",
                                  columnWidth: 48,
                                  selectedRowKeys,
                                  ...rowSelection,
                              }
                            : undefined
                    }
                    rowKey={(record) => {
                        return record.id || record.key
                    }}
                    className={clsx("ph-no-capture", "grow min-h-0", "eval-runs-table")}
                    columns={columns}
                    dataSource={dataSource}
                    tableLayout="fixed"
                    loading={isLoadingPreview || isLoadingLegacy}
                    uniqueKey="human-annotation"
                    onRow={(record) => ({
                        style: {cursor: "pointer"},
                        onClick: () =>
                            router.push(
                                `/apps/${appId}/evaluations/single_model_test/${"id" in record ? record.id : record.key}`,
                            ),
                    })}
                />
            </div>
            <div className="h-6 w-full" />
        </div>
    )
}

export default memo(SingleModelEvaluation)
