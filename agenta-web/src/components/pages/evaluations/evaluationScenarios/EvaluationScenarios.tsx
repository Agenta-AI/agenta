import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, _Evaluation, _EvaluationScenario} from "@/lib/Types"
import {deleteEvaluations, fetchAllEvaluationScenarios} from "@/services/evaluations"
import {DeleteOutlined, DownloadOutlined} from "@ant-design/icons"
import {ColDef} from "ag-grid-community"
import {AgGridReact} from "ag-grid-react"
import {Space, Spin, Tooltip, Typography} from "antd"
import {useRouter} from "next/router"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {getFilterParams, getTypedValue} from "../evaluationResults/EvaluationResults"
import {getAppValues} from "@/contexts/app.context"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {LongTextCellRenderer} from "../cellRenderers/cellRenderers"

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
    const gridRef = useRef<AgGridReact<_EvaluationScenario>>()
    const evalaution = scenarios[0]?.evaluation

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_EvaluationScenario>[] = []
        if (!scenarios.length || !evalaution) return colDefs

        scenarios[0]?.inputs.forEach((input, index) => {
            colDefs.push({
                flex: 1,
                headerName: `Input: ${input.name}`,
                ...getFilterParams(input.type === "number" ? "number" : "text"),
                field: `inputs.${index}`,
                valueGetter: (params) => {
                    return getTypedValue(params.data?.inputs[index])
                },
                cellRenderer: LongTextCellRenderer,
            })
        })
        colDefs.push({
            flex: 1,
            headerName: "Expected Output",
            field: "correct_answer",
            ...getFilterParams("text"),
            valueGetter: (params) => {
                return params.data?.correct_answer?.toString() || ""
            },
            cellRenderer: LongTextCellRenderer,
        })
        evalaution?.variants.forEach((_, index) => {
            colDefs.push({
                flex: 1,
                headerName: "Output",
                ...getFilterParams("text"),
                field: `outputs.0`,
                valueGetter: (params) => {
                    return getTypedValue(params.data?.outputs[index])
                },
                cellRenderer: LongTextCellRenderer,
            })
        })
        scenarios[0]?.evaluators_configs.forEach((config) => {
            colDefs.push({
                headerName: `Evaluator: ${config.name}`,
                field: `results`,
                ...getFilterParams("text"),
                valueGetter: (params) => {
                    return getTypedValue(
                        params.data?.results.find((item) => item.evaluator_config === config.id)
                            ?.result,
                    )
                },
            })
        })
        return colDefs
    }, [evalaution, scenarios])

    const fetcher = () => {
        setFetching(true)
        fetchAllEvaluationScenarios(evaluationId)
            .then((scenarios) => {
                setScenarios(scenarios)
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
