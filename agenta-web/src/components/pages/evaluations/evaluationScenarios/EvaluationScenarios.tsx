import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {
    CorrectAnswer,
    EvaluatorConfig,
    JSSTheme,
    _Evaluation,
    _EvaluationScenario,
} from "@/lib/Types"
import {
    deleteEvaluations,
    fetchAllEvaluationScenarios,
    fetchAllEvaluators,
} from "@/services/evaluations/api"
import {CheckOutlined, DeleteOutlined, DownloadOutlined} from "@ant-design/icons"
import {type ColDef, type ICellRendererParams} from "@ag-grid-community/core"
import {DropdownProps, Space, Spin, Tag, Tooltip, Typography} from "antd"
import {useRouter} from "next/router"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {getFilterParams, getTypedValue} from "@/lib/helpers/evaluate"
import {getAppValues} from "@/contexts/app.context"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {LongTextCellRenderer, ResultRenderer} from "../cellRenderers/cellRenderers"
import AgCustomHeader from "@/components/AgCustomHeader/AgCustomHeader"
import {useAtom} from "jotai"
import {evaluatorsAtom} from "@/lib/atoms/evaluation"
import CompareOutputDiff from "@/components/CompareOutputDiff/CompareOutputDiff"
import {formatCurrency, formatLatency} from "@/lib/helpers/formatters"
import EvaluationErrorModal from "../EvaluationErrorProps/EvaluationErrorModal"
import EvaluationErrorText from "../EvaluationErrorProps/EvaluationErrorText"
import uniqBy from "lodash/uniqBy"
import FilterColumns, {generateFilterItems} from "../FilterColumns/FilterColumns"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {escapeNewlines} from "@/lib/helpers/fileManipulations"
import {getStringOrJson} from "@/lib/helpers/utils"
import AgGridReact, {type AgGridReactType} from "@/lib/helpers/agGrid"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    infoRow: {
        marginTop: "1rem",
        margin: "0.75rem 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    date: {
        fontSize: "0.75rem",
        color: "#8c8c8c",
        display: "inline-block",
    },
    table: {
        height: "calc(100vh - 240px)",
    },
}))

interface Props {}

const EvaluationScenarios: React.FC<Props> = () => {
    const router = useRouter()
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const evaluationId = router.query.evaluation_id as string
    const [scenarios, setScenarios] = useState<_EvaluationScenario[]>([])
    const [fetching, setFetching] = useState(false)
    const [evaluators, setEvaluators] = useAtom(evaluatorsAtom)
    const [gridRef, setGridRef] = useState<AgGridReactType<_EvaluationScenario>>()
    const evalaution = scenarios[0]?.evaluation
    const [selectedCorrectAnswer, setSelectedCorrectAnswer] = useState(["noDiffColumnIsSelected"])
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
    const [isDiffDropdownOpen, setIsDiffDropdownOpen] = useState(false)
    const [hiddenCols, setHiddenCols] = useState<string[]>([])

    const handleOpenChangeFilterCols: DropdownProps["onOpenChange"] = (nextOpen, info) => {
        if (info.source === "trigger" || nextOpen) {
            setIsFilterColsDropdownOpen(nextOpen)
        }
    }

    const handleOpenChangeDiff: DropdownProps["onOpenChange"] = (nextOpen, info) => {
        if (info.source === "trigger" || nextOpen) {
            setIsDiffDropdownOpen(nextOpen)
        }
    }

    const uniqueCorrectAnswers: CorrectAnswer[] = uniqBy(scenarios[0]?.correct_answers || [], "key")
    const [modalErrorMsg, setModalErrorMsg] = useState({message: "", stackTrace: ""})
    const [isErrorModalOpen, setIsErrorModalOpen] = useState(false)

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_EvaluationScenario>[] = []
        if (!scenarios.length || !evalaution) return colDefs

        scenarios[0]?.inputs.forEach((input, index) => {
            colDefs.push({
                flex: 1,
                minWidth: 240,
                headerName: `Input: ${input.name}`,
                hide: hiddenCols.includes(`Input: ${input.name}`),
                headerComponent: (props: any) => {
                    return (
                        <AgCustomHeader {...props}>
                            <Space direction="vertical" className="py-2">
                                <span>{input.name}</span>
                                <Tag color="blue">Input</Tag>
                            </Space>
                        </AgCustomHeader>
                    )
                },
                ...getFilterParams(input.type === "number" ? "number" : "text"),
                field: `inputs.${index}`,
                valueGetter: (params) => {
                    return getTypedValue(params.data?.inputs[index])
                },
                cellRenderer: (params: any) => LongTextCellRenderer(params),
            })
        })

        uniqueCorrectAnswers.forEach((answer: CorrectAnswer, index: number) => {
            colDefs.push({
                headerName: answer.key,
                hide: hiddenCols.includes(answer.key),
                headerComponent: (props: any) => {
                    return (
                        <AgCustomHeader {...props}>
                            <Space direction="vertical" className="py-2">
                                <span>{answer.key}</span>
                                <Tag color="green">Ground Truth</Tag>
                            </Space>
                        </AgCustomHeader>
                    )
                },
                minWidth: 200,
                flex: 1,
                ...getFilterParams("text"),
                valueGetter: (params) => params.data?.correct_answers?.[index]?.value || "",
                cellRenderer: (params: any) => LongTextCellRenderer(params),
            })
        })
        evalaution?.variants.forEach((_, index) => {
            colDefs.push({
                flex: 1,
                minWidth: 300,
                headerName: "Output",
                hide: hiddenCols.includes("Output"),
                ...getFilterParams("text"),
                field: `outputs.0`,
                cellRenderer: (params: ICellRendererParams<_EvaluationScenario>) => {
                    const correctAnswer = params?.data?.correct_answers?.find(
                        (item: any) => item.key === selectedCorrectAnswer[0],
                    )
                    const result = params.data?.outputs[index].result

                    if (result && result.error && result.type == "error") {
                        return (
                            <EvaluationErrorText
                                text="Failure to compute evaluation"
                                handleOnClick={() => {
                                    setModalErrorMsg({
                                        message: result.error?.message || "",
                                        stackTrace: result.error?.stacktrace || "",
                                    })
                                    setIsErrorModalOpen(true)
                                }}
                            />
                        )
                    }
                    return selectedCorrectAnswer[0] !== "noDiffColumnIsSelected"
                        ? LongTextCellRenderer(
                              params,
                              <CompareOutputDiff
                                  variantOutput={getStringOrJson(result?.value)}
                                  expectedOutput={correctAnswer?.value || ""}
                              />,
                          )
                        : LongTextCellRenderer(params)
                },
                valueGetter: (params: any) => {
                    const result = params.data?.outputs[index].result.value
                    return getStringOrJson(result)
                },
            })
        })
        scenarios[0]?.evaluators_configs.forEach((config, index) => {
            colDefs.push({
                headerName: config?.name,
                hide: hiddenCols.includes(config.name),
                headerComponent: (props: any) => {
                    const evaluator = evaluators.find((item) => item.key === config?.evaluator_key)!
                    return (
                        <AgCustomHeader {...props}>
                            <Space direction="vertical" style={{padding: "0.5rem 0"}}>
                                <span>{config.name}</span>
                                <Tag color={evaluator?.color}>{evaluator?.name}</Tag>
                            </Space>
                        </AgCustomHeader>
                    )
                },
                autoHeaderHeight: true,
                field: `results`,
                ...getFilterParams("text"),
                cellRenderer: (
                    params: ICellRendererParams<_EvaluationScenario> & {
                        config: EvaluatorConfig
                    },
                ) => {
                    const result = params.data?.results.find(
                        (item) => item.evaluator_config === params.config.id,
                    )?.result

                    return result?.type === "error" && result.error ? (
                        <EvaluationErrorText
                            text="Failure to compute evaluation"
                            handleOnClick={() => {
                                setModalErrorMsg({
                                    message: result.error?.message || "",
                                    stackTrace: result.error?.stacktrace || "",
                                })
                                setIsErrorModalOpen(true)
                            }}
                        />
                    ) : (
                        <ResultRenderer {...params} />
                    )
                },
                cellRendererParams: {
                    config,
                },
                valueGetter: (params) => {
                    return params.data?.results[index].result.value
                },
            })
        })
        colDefs.push({
            flex: 1,
            minWidth: 120,
            headerName: "Cost",
            hide: hiddenCols.includes("Cost"),
            ...getFilterParams("text"),
            valueGetter: (params) => {
                return params.data?.outputs[0].cost == undefined
                    ? "-"
                    : formatCurrency(params.data.outputs[0].cost)
            },
        })

        colDefs.push({
            flex: 1,
            minWidth: 120,
            headerName: "Latency",
            hide: hiddenCols.includes("Latency"),
            ...getFilterParams("text"),
            valueGetter: (params) => {
                return params.data?.outputs[0].latency == undefined
                    ? "-"
                    : formatLatency(params.data.outputs[0].latency)
            },
        })
        return colDefs
    }, [evalaution, scenarios, selectedCorrectAnswer, hiddenCols, evaluators, uniqueCorrectAnswers])

    const shownCols = useMemo(
        () =>
            colDefs
                .map((item) => item.headerName)
                .filter((item) => item !== undefined && !hiddenCols.includes(item)) as string[],
        [colDefs, hiddenCols],
    )

    const onToggleEvaluatorVisibility = (evalConfigId: string) => {
        if (!hiddenCols.includes(evalConfigId)) {
            setHiddenCols([...hiddenCols, evalConfigId])
        } else {
            setHiddenCols(hiddenCols.filter((item) => item !== evalConfigId))
        }
    }

    const fetcher = () => {
        setFetching(true)
        Promise.all([
            evaluators.length ? Promise.resolve(evaluators) : fetchAllEvaluators(),
            fetchAllEvaluationScenarios(evaluationId),
        ])
            .then(([evaluators, scenarios]) => {
                setScenarios(scenarios)
                setEvaluators(evaluators)
                setTimeout(() => {
                    if (!gridRef) return

                    const ids: string[] =
                        gridRef.api
                            .getColumns()
                            ?.filter((column) => column.getColDef().field === "results")
                            ?.map((item) => item.getColId()) || []
                    gridRef.api.autoSizeColumns(ids, false)
                    setFetching(false)
                }, 100)
            })
            .catch(console.error)
            .finally(() => setFetching(false))
    }

    useEffect(() => {
        if (!gridRef) return
        fetcher()
    }, [appId, gridRef, evaluationId])

    const onExport = () => {
        if (!gridRef) return
        const {currentApp} = getAppValues()
        gridRef.api.exportDataAsCsv({
            fileName: `${currentApp?.app_name}_${evalaution.variants[0].variantName}.csv`,
            processHeaderCallback: (params) => {
                if (params.column.getColDef().headerName === "Output") {
                    return `Output ${variantNameWithRev({
                        variant_name: evalaution?.variants[0].variantName ?? "",
                        revision: evalaution.revisions[0],
                    })}`
                }
                return params.column.getColDef().headerName as string
            },
            processCellCallback: (params) =>
                typeof params.value === "string" ? escapeNewlines(params.value) : params.value,
        })
    }

    const onDelete = () => {
        AlertPopup({
            title: "Delete Evaluation",
            message: "Are you sure you want to delete this evaluation?",
            onOk: () =>
                deleteEvaluations([evaluationId])
                    .then(() => router.push(`/apps/${appId}/evaluations`))
                    .catch(console.error),
        })
    }

    return (
        <div>
            <Typography.Title level={3}>Evaluation Results</Typography.Title>
            <div className={classes.infoRow}>
                <Space size="large">
                    <Typography.Text className={classes.date}>
                        {formatDate(evalaution?.created_at)}
                    </Typography.Text>
                    <Space>
                        <Typography.Text strong>Testset:</Typography.Text>
                        <Typography.Link href={`/testsets/${evalaution?.testset.id}`}>
                            {evalaution?.testset.name || ""}
                        </Typography.Link>
                    </Space>
                    <Space>
                        <Typography.Text strong>Variant:</Typography.Text>
                        <Typography.Link
                            href={`/apps/${appId}/playground?variant=${evalaution?.variants[0].variantName}`}
                        >
                            {variantNameWithRev({
                                variant_name: evalaution?.variants[0].variantName ?? "",
                                revision: evalaution?.revisions[0],
                            })}
                        </Typography.Link>
                    </Space>
                </Space>
                <Space size="middle" align="center">
                    <FilterColumns
                        items={generateFilterItems(colDefs)}
                        isOpen={isFilterColsDropdownOpen}
                        handleOpenChange={handleOpenChangeFilterCols}
                        shownCols={shownCols}
                        onClick={({key}) => {
                            onToggleEvaluatorVisibility(key)
                            setIsFilterColsDropdownOpen(true)
                        }}
                    />
                    {!!scenarios.length && !!scenarios[0].correct_answers?.length && (
                        <div className="flex items-center gap-2">
                            <Typography.Text>Apply difference with: </Typography.Text>
                            <FilterColumns
                                items={uniqueCorrectAnswers.map((answer) => ({
                                    key: answer.key as string,
                                    label: (
                                        <Space>
                                            <CheckOutlined />
                                            <>{answer.key}</>
                                        </Space>
                                    ),
                                }))}
                                buttonText={
                                    selectedCorrectAnswer[0] === "noDiffColumnIsSelected"
                                        ? "Select Ground Truth"
                                        : selectedCorrectAnswer[0]
                                }
                                isOpen={isDiffDropdownOpen}
                                handleOpenChange={handleOpenChangeDiff}
                                shownCols={selectedCorrectAnswer}
                                onClick={({key}) => {
                                    if (key === selectedCorrectAnswer[0]) {
                                        setSelectedCorrectAnswer(["noDiffColumnIsSelected"])
                                    } else {
                                        setSelectedCorrectAnswer([key])
                                    }
                                    setIsDiffDropdownOpen(true)
                                }}
                            />
                        </div>
                    )}
                    <Tooltip title="Export as CSV">
                        <DownloadOutlined onClick={onExport} style={{fontSize: 16}} />
                    </Tooltip>
                    <Tooltip title="Delete Evaluation">
                        <DeleteOutlined onClick={onDelete} style={{fontSize: 16}} />
                    </Tooltip>
                </Space>
            </div>

            <Spin spinning={fetching}>
                <div
                    className={`${
                        appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"
                    } ${classes.table}`}
                    data-cy="evalaution-scenarios-table"
                >
                    <AgGridReact<_EvaluationScenario>
                        gridRef={setGridRef}
                        rowData={scenarios}
                        columnDefs={colDefs}
                        getRowId={(params) => params.data.id}
                    />
                </div>
            </Spin>

            <EvaluationErrorModal
                isErrorModalOpen={isErrorModalOpen}
                setIsErrorModalOpen={setIsErrorModalOpen}
                modalErrorMsg={modalErrorMsg}
            />
        </div>
    )
}

export default EvaluationScenarios
