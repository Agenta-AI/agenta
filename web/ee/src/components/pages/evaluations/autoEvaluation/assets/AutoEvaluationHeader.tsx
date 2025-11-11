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
import {EvaluationType} from "@/oss/lib/enums"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"

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

    const {refetch} = useEvaluations({
        withPreview: true,
        types: [EvaluationType.automatic, EvaluationType.auto_exact_match],
        evalType: "auto",
    })

    const onExport = useCallback(() => {
        const exportEvals = evaluations.filter((e) =>
            selectedRowKeys.some((selected) => selected === e.id),
        )

        try {
            if (exportEvals.length) {
                const {currentApp} = getAppValues()
                const filename = `${currentApp?.app_name}_evaluation_scenarios.csv`

                const csvData = convertToCsv(
                    exportEvals.map((item) => ({
                        Variant: variantNameWithRev({
                            variant_name: item.variants[0].variantName ?? "",
                            revision: item.revisions[0],
                        }),
                        Testset: item.testset.name,
                        ...item.aggregated_results.reduce((acc, curr) => {
                            if (!acc[curr.evaluator_config.name]) {
                                acc[curr.evaluator_config.name] = getTypedValue(curr.result)
                            }
                            return acc
                        }, {} as GenericObject),
                        "Avg. Latency": getTypedValue(item.average_latency),
                        "Total Cost": getTypedValue(item.average_cost),
                        "Created on": formatDate24(item.created_at),
                        Status: statusMapper(token)(item.status?.value as EvaluationStatus).label,
                    })),
                    columns.flatMap((col: any) => {
                        const titles = [col.title].filter(
                            (title) => title !== "Results" && typeof title === "string",
                        )
                        const childTitles =
                            col.children?.flatMap((item: any) => (item.key ? item.key : [])) || []

                        return [...titles, ...childTitles]
                    }),
                )
                downloadCsv(csvData, filename)
                setSelectedRowKeys([])
            }
        } catch (error) {
            message.error("Failed to export results. Plese try again later")
        }
    }, [])

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
