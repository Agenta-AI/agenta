import {isValidElement, useCallback, useMemo, useState} from "react"

import {Export, Trash} from "@phosphor-icons/react"
import {Button, Space, message} from "antd"
import type {ColumnType, ColumnsType} from "antd/es/table"
import {useAtom} from "jotai"
import {useRouter} from "next/router"
import {renderToStaticMarkup} from "react-dom/server"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import EditColumns from "@/oss/components/Filters/EditColumns"
import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import {getColumns} from "@/oss/components/HumanEvaluations/assets/utils"
import type {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {EvaluationType} from "@/oss/lib/enums"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"
import {EvaluationStatus} from "@/oss/lib/Types"
import {getAppValues} from "@/oss/state/app"

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

type ExportableColumn = {
    header: string
    column: ColumnType<EvaluationRow>
}

const decodeHtmlEntities = (value: string): string =>
    value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')

const stripHtml = (markup: string): string => {
    if (!markup) return ""
    const withoutTags = markup.replace(/<[^>]+>/g, " ")
    return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim()
}

const nodeToText = (node: any): string => {
    if (node === null || node === undefined) return ""
    if (typeof node === "string" || typeof node === "number") return String(node)
    if (typeof node === "boolean") return node ? "true" : "false"
    if (Array.isArray(node)) {
        return node
            .map((item) => nodeToText(item))
            .filter(Boolean)
            .join(" ")
    }
    if (isValidElement(node)) {
        return stripHtml(renderToStaticMarkup(node))
    }
    if (typeof node === "object") {
        try {
            return stripHtml(renderToStaticMarkup(<>{node}</>))
        } catch (_error) {
            return ""
        }
    }
    return ""
}

const getValueFromDataIndex = (
    record: EvaluationRow,
    dataIndex: ColumnType<EvaluationRow>["dataIndex"],
): any => {
    if (dataIndex === undefined || dataIndex === null) return undefined
    const path =
        typeof dataIndex === "number"
            ? [dataIndex]
            : Array.isArray(dataIndex)
              ? dataIndex
              : String(dataIndex).split(".")

    return path.reduce((acc: any, key) => {
        if (acc === null || acc === undefined) return undefined
        if (typeof key === "number") {
            return acc?.[key]
        }
        const candidate = acc?.[key]
        if (candidate !== undefined) return candidate
        if (typeof key === "string") {
            const numericKey = Number.isNaN(Number(key)) ? key : Number(key)
            return acc?.[numericKey as keyof typeof acc]
        }
        return undefined
    }, record)
}

const resolveColumnTitle = (title: ColumnType<EvaluationRow>["title"]): string => {
    if (title === null || title === undefined) return ""
    if (typeof title === "string") return title
    if (typeof title === "number" || typeof title === "boolean") return String(title)
    if (typeof title === "function") {
        try {
            const node = title({})
            return nodeToText(node)
        } catch (_error) {
            return ""
        }
    }
    if (isValidElement(title)) {
        return nodeToText(title)
    }
    return ""
}

const flattenColumnsForExport = (
    columns: ColumnsType<EvaluationRow>,
    parentTitles: string[] = [],
): ExportableColumn[] => {
    const flattened: ExportableColumn[] = []
    columns.forEach((col) => {
        const currentTitle = resolveColumnTitle(col.title)
        const nextParentTitles = currentTitle ? [...parentTitles, currentTitle] : parentTitles

        if ("children" in col && col.children && col.children.length) {
            flattened.push(...flattenColumnsForExport(col.children, nextParentTitles))
            return
        }

        const header =
            nextParentTitles.join(" / ") ||
            String(
                col.key ??
                    (Array.isArray(col.dataIndex)
                        ? col.dataIndex.join(".")
                        : (col.dataIndex ?? "")),
            )

        if (!header.trim()) return
        if (String(col.key ?? "").toLowerCase() === "key") return

        flattened.push({
            header,
            column: col,
        })
    })
    return flattened
}

const extractColumnValue = (
    column: ColumnType<EvaluationRow>,
    record: EvaluationRow,
    index: number,
): string => {
    const baseValue = getValueFromDataIndex(record, column.dataIndex)
    const rendered = column.render ? column.render(baseValue, record, index) : baseValue
    let text = nodeToText(rendered)

    if (!text && baseValue !== undefined) {
        text = nodeToText(baseValue)
    }

    return text
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
            preferRunStepSlugs: true,
            disableVariantAction: true,
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

    const exportColumns = useMemo(() => flattenColumnsForExport(visibleColumns), [visibleColumns])

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

    const selectedKeySet = useMemo(() => {
        const set = new Set<string>()
        selectedRowKeys.forEach((key) => {
            if (key == null) return
            const value = key.toString()
            if (value) set.add(value)
        })
        return set
    }, [selectedRowKeys])

    const recordIndexLookup = useMemo(() => {
        const map = new Map<string, number>()
        mergedEvaluations.forEach((evaluation, idx) => {
            const key = ("id" in evaluation ? evaluation.id : evaluation.key)?.toString()
            if (key) {
                map.set(key, idx)
            }
        })
        return map
    }, [mergedEvaluations])

    const selectedEvaluations = useMemo(() => {
        if (selectedEvalRecord) {
            const selectedId = (
                "id" in selectedEvalRecord ? selectedEvalRecord.id : selectedEvalRecord.key
            )?.toString()
            const matched = selectedId
                ? mergedEvaluations.find((evaluation) => {
                      const evalId = (
                          "id" in evaluation ? evaluation.id : evaluation.key
                      )?.toString()
                      return evalId === selectedId
                  })
                : undefined
            return matched ? [matched] : [selectedEvalRecord]
        }
        if (!selectedKeySet.size) return []
        return mergedEvaluations.filter((evaluation) => {
            const key = ("id" in evaluation ? evaluation.id : evaluation.key)?.toString()
            return key ? selectedKeySet.has(key) : false
        })
    }, [selectedEvalRecord, selectedKeySet, mergedEvaluations])

    const selectedEvaluationsLabel = useMemo(() => {
        if (!selectedEvaluations.length) return "Custom evaluation"
        return selectedEvaluations
            .map((item) => ("name" in item ? item.name : item.key))
            .join(" | ")
    }, [selectedEvaluations])

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
                    query: recordAppId
                        ? {app_id: recordAppId, eval_type: "custom"}
                        : {eval_type: "custom"},
                })
            } else {
                router.push({
                    pathname: targetPath,
                    query: {eval_type: "custom"},
                })
            }
        },
        [activeAppId, scope, baseAppURL, projectURL, router],
    )

    const handleExportSelected = useCallback(() => {
        if (!selectedEvaluations.length) {
            message.warning("Select at least one evaluation to export")
            return
        }

        if (!exportColumns.length) {
            message.warning("There are no visible columns to export")
            return
        }

        try {
            const rows = selectedEvaluations.map((item) => {
                const key = ("id" in item ? item.id : item.key)?.toString()
                const recordIndex = key ? (recordIndexLookup.get(key) ?? 0) : 0
                const row: Record<string, string> = {}

                exportColumns.forEach(({header, column}) => {
                    row[header] = extractColumnValue(column, item, recordIndex) || ""
                })

                return row
            })

            const headers = exportColumns.map(({header}) => header)

            const csvData = convertToCsv(rows, headers)
            if (!csvData) {
                message.error("Failed to prepare export")
                return
            }

            const {currentApp} = getAppValues()
            const filenameBase =
                currentApp?.app_name || (scope === "project" ? "all_applications" : "evaluations")
            const filename = `${filenameBase.replace(/\s+/g, "_")}_custom_evaluations.csv`
            downloadCsv(filename, csvData)
        } catch (error) {
            console.error("Failed to export custom evaluations", error)
            message.error("Failed to export evaluations")
        }
    }, [selectedEvaluations, exportColumns, recordIndexLookup, scope])

    return (
        <section className="flex flex-col gap-2 pb-4">
            <div className="flex items-center justify-between">
                <Space size={8} wrap>
                    <Button
                        type="text"
                        className="flex items-center"
                        onClick={handleExportSelected}
                        disabled={selectedEvaluations.length === 0}
                        icon={<Export size={14} className="mt-0.5" />}
                    >
                        Export as CSV
                    </Button>
                    <Button
                        type="text"
                        danger
                        className="flex items-center"
                        disabled={selectedEvaluations.length === 0}
                        icon={<Trash size={14} />}
                        onClick={() => setIsDeleteEvalModalOpen(true)}
                    >
                        Delete
                    </Button>
                </Space>
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
                    const ids = selectedEvaluations
                        .map((evaluation) =>
                            "id" in evaluation ? evaluation.id : evaluation.key?.toString(),
                        )
                        .filter(Boolean) as string[]
                    if (ids.length) {
                        await handleDelete(ids)
                    }
                }}
                evaluationType={selectedEvaluationsLabel}
                isMultiple={selectedEvaluations.length > 1}
            />
        </section>
    )
}

export default CustomEvaluation
