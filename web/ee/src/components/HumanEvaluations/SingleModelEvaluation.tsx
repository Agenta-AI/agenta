import {memo, useMemo, useCallback, useState, type Key} from "react"

import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {useRouter} from "next/router"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {EvaluationType} from "@/oss/lib/enums"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"
import {useAppsData} from "@/oss/state/app"

import SingleModelEvaluationHeader from "./assets/SingleModelEvaluationHeader"
import {useStyles} from "./assets/styles"
import {getColumns} from "./assets/utils"
import {EvaluationRow} from "./types"
import {
    buildAppScopedUrl,
    buildEvaluationNavigationUrl,
    extractEvaluationAppId,
} from "../pages/evaluations/utils"

interface SingleModelEvaluationProps {
    viewType: "evaluation" | "overview"
    scope?: "app" | "project"
}

const SingleModelEvaluation = ({viewType, scope = "app"}: SingleModelEvaluationProps) => {
    const classes = useStyles()
    const router = useRouter()
    const {appURL, projectURL, baseAppURL} = useURL()
    const routeAppId = useAppId()
    const activeAppId = scope === "app" ? routeAppId || undefined : undefined
    const {apps: availableApps = []} = useAppsData()

    const [selectedEvalRecord, setSelectedEvalRecord] = useState<EvaluationRow>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

    const {mergedEvaluations, isLoadingPreview, isLoadingLegacy} = useEvaluations({
        withPreview: true,
        types: [EvaluationType.single_model_test],
        evalType: "human",
        appId: activeAppId,
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

    const knownAppIds = useMemo(() => {
        return new Set(
            (availableApps as Array<{app_id?: string}>)
                .map((app) => app?.app_id)
                .filter(Boolean) as string[],
        )
    }, [availableApps])

    const resolveAppId = useCallback(
        (record: EvaluationRow): string | undefined => {
            const candidate = extractEvaluationAppId(record) || activeAppId
            if (!candidate) return undefined
            if (scope === "project" && !knownAppIds.has(candidate)) return undefined
            return candidate
        },
        [activeAppId, knownAppIds, scope],
    )

    const isRecordNavigable = useCallback(
        (record: EvaluationRow): boolean => {
            const evaluationId = "id" in record ? record.id : record.key
            const recordAppId = resolveAppId(record)
            return Boolean(evaluationId && recordAppId)
        },
        [resolveAppId],
    )

    const rowSelection = useMemo(() => {
        return {
            onChange: (selectedRowKeys: Key[]) => {
                setSelectedRowKeys(selectedRowKeys)
            },
            getCheckboxProps: (record: EvaluationRow) => ({
                disabled: !isRecordNavigable(record),
            }),
        }
    }, [isRecordNavigable])

    const handleNavigation = useCallback(
        ({revisionId, appId: recordAppId}: {revisionId: string; appId?: string}) => {
            const targetAppId = recordAppId || activeAppId
            if (!targetAppId) return

            router.push({
                pathname: buildAppScopedUrl(baseAppURL, targetAppId, "/playground"),
                query: {
                    revisions: buildRevisionsQueryParam([revisionId]),
                },
            })
        },
        [router, baseAppURL, activeAppId],
    )

    const columns: ColumnsType<EvaluationRow> = useMemo(() => {
        return getColumns({
            evaluations: mergedEvaluations,
            onVariantNavigation: handleNavigation,
            evalType: "human",
            setSelectedEvalRecord,
            setIsDeleteEvalModalOpen,
            runMetricsMap,
            scope,
            baseAppURL,
            extractAppId: extractEvaluationAppId,
            projectURL,
            resolveAppId,
        })
    }, [
        mergedEvaluations,
        handleNavigation,
        setSelectedEvalRecord,
        setIsDeleteEvalModalOpen,
        runMetricsMap,
        scope,
        baseAppURL,
        projectURL,
        resolveAppId,
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
                scope={scope}
                projectURL={projectURL}
                activeAppId={activeAppId}
                extractAppId={extractEvaluationAppId}
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
                    showHorizontalScrollBar={true}
                    columns={columns}
                    dataSource={dataSource}
                    virtualized
                    loading={isLoadingPreview || isLoadingLegacy}
                    uniqueKey="human-annotation"
                    onRow={(record) => {
                        const evaluationId = "id" in record ? record.id : record.key
                        const recordAppId = resolveAppId(record)
                        const isNavigable = isRecordNavigable(record)

                        return {
                            className: isNavigable ? undefined : "cursor-not-allowed opacity-60",
                            style: {cursor: isNavigable ? "pointer" : "not-allowed"},
                            onClick: () => {
                                if (!isNavigable || !recordAppId || !evaluationId) return

                                const pathname = buildEvaluationNavigationUrl({
                                    scope,
                                    baseAppURL,
                                    projectURL,
                                    appId: recordAppId,
                                    path: `/evaluations/single_model_test/${evaluationId}`,
                                })

                                if (scope === "project") {
                                    router.push({
                                        pathname,
                                        query: recordAppId ? {app_id: recordAppId} : undefined,
                                    })
                                } else {
                                    router.push(pathname)
                                }
                            },
                        }
                    }}
                />
            </div>
        </div>
    )
}

export default memo(SingleModelEvaluation)
