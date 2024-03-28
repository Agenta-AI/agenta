import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, _Evaluation, _EvaluationScenario} from "@/lib/Types"
import {
    deleteEvaluations,
    fetchAllEvaluationScenarios,
    fetchAllEvaluators,
} from "@/services/evaluations"
import {DeleteOutlined, DownloadOutlined} from "@ant-design/icons"
import {ColDef} from "ag-grid-community"
import {AgGridReact} from "ag-grid-react"
import {Space, Spin, Switch, Tag, Tooltip, Typography} from "antd"
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
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency} from "@/lib/helpers/formatters"

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
    const gridRef = useRef<AgGridReact<_EvaluationScenario>>()
    const evalaution = scenarios[0]?.evaluation
    const [showDiff, setShowDiff] = useQueryParam("showDiff", "show")

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_EvaluationScenario>[] = []
        if (!scenarios.length || !evalaution) return colDefs

        scenarios[0]?.inputs.forEach((input, index) => {
            colDefs.push({
                flex: 1,
                minWidth: 240,
                headerName: `Input: ${input.name}`,
                ...getFilterParams(input.type === "number" ? "number" : "text"),
                field: `inputs.${index}`,
                valueGetter: (params) => {
                    return getTypedValue(params.data?.inputs[index])
                },
                cellRenderer: (params: any) => LongTextCellRenderer(params),
            })
        })
        colDefs.push({
            flex: 1,
            minWidth: 300,
            headerName: "Expected Output",
            field: "correct_answer",
            ...getFilterParams("text"),
            valueGetter: (params) => {
                return params.data?.correct_answer?.toString() || ""
            },
            cellRenderer: (params: any) => LongTextCellRenderer(params),
        })
        evalaution?.variants.forEach((_, index) => {
            colDefs.push({
                flex: 1,
                minWidth: 300,
                headerName: "Output",
                ...getFilterParams("text"),
                field: `outputs.0`,
                cellRenderer: (params: any) => {
                    const result = params.data?.outputs[index].result
                    if (result && result.type == "error") {
                        return `${result?.error?.message}\n${result?.error?.stacktrace}`
                    }
                    return showDiff === "show"
                        ? LongTextCellRenderer(
                              params,
                              <CompareOutputDiff
                                  variantOutput={result?.value}
                                  expectedOutput={params.data?.correct_answer}
                              />,
                          )
                        : LongTextCellRenderer(params)
                },
                valueGetter: (params) => {
                    const result = params.data?.outputs[index].result
                    return result?.value
                },
            })
        })
        scenarios[0]?.evaluators_configs.forEach((config, index) => {
            colDefs.push({
                headerName: config?.name,
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
                cellRenderer: ResultRenderer,
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
            field: "cost",
            ...getFilterParams("text"),
            valueGetter: (params) => {
                return formatCurrency(params.data.outputs[0].cost)
            },
        })

        colDefs.push({
            flex: 1,
            minWidth: 120,
            headerName: "Latency",
            field: "latency",
            ...getFilterParams("text"),
            valueGetter: (params) => {
                return formatLatency(params.data.outputs[0].latency)
            },
        })
        return colDefs
    }, [evalaution, scenarios, showDiff])

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
                    if (!gridRef.current) return

                    const ids: string[] =
                        gridRef.current.api
                            .getColumns()
                            ?.filter((column) => column.getColDef().field === "results")
                            ?.map((item) => item.getColId()) || []
                    gridRef.current.api.autoSizeColumns(ids, false)
                    setFetching(false)
                }, 100)
            })
            .catch(console.error)
            .finally(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [appId, evaluationId])

    const onExport = () => {
        if (!gridRef.current) return
        const {currentApp} = getAppValues()
        gridRef.current.api.exportDataAsCsv({
            fileName: `${currentApp?.app_name}_${evalaution.variants[0].variantName}.csv`,
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
                        <Typography.Link href={`/apps/${appId}/testsets/${evalaution?.testset.id}`}>
                            {evalaution?.testset.name || ""}
                        </Typography.Link>
                    </Space>
                    <Space>
                        <Typography.Text strong>Variant:</Typography.Text>
                        <Typography.Link
                            href={`/apps/${appId}/playground/?variant=${evalaution?.variants[0].variantName}`}
                        >
                            {evalaution?.variants[0].variantName || ""}
                        </Typography.Link>
                    </Space>
                </Space>
                <Space size="middle" align="center">
                    <Space>
                        <Typography.Text>Show Difference: </Typography.Text>
                        <Switch
                            value={showDiff === "show"}
                            onClick={() => setShowDiff(showDiff === "show" ? "hide" : "show")}
                        />
                    </Space>
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
                        ref={gridRef as any}
                        rowData={scenarios}
                        columnDefs={colDefs}
                        getRowId={(params) => params.data.id}
                    />
                </div>
            </Spin>
        </div>
    )
}

export default EvaluationScenarios
