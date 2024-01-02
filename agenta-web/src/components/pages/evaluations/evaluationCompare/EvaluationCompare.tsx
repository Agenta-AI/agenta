import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, _Evaluation, _EvaluationScenario} from "@/lib/Types"
import {fetchAllEvaluationScenarios} from "@/services/evaluations"
import {ColDef} from "ag-grid-community"
import {AgGridReact} from "ag-grid-react"
import {Space, Spin, Tag, Tooltip, Typography} from "antd"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {
    LongTextCellRenderer,
    getFilterParams,
    getTypedValue,
} from "../evaluationResults/EvaluationResults"
import {uniqBy} from "lodash"
import {getTagColors} from "@/lib/helpers/colors"
import {DownloadOutlined} from "@ant-design/icons"
import {getAppValues} from "@/contexts/app.context"
import {useQueryParam} from "@/hooks/useQuery"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    table: {
        height: "calc(100vh - 240px)",
    },
    infoRow: {
        marginTop: "1rem",
        margin: "0.75rem 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
}))

interface Props {}

const EvaluationCompareMode: React.FC<Props> = () => {
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const [evaluationIds, setEvaluationIds] = useQueryParam("evaluations")
    const [scenarios, setScenarios] = useState<_EvaluationScenario[]>([])
    const [fetching, setFetching] = useState(false)
    const gridRef = useRef<AgGridReact<_EvaluationScenario>>()

    const evalautions = useMemo(() => {
        return uniqBy(
            scenarios.map((scenario) => scenario.evaluation),
            "id",
        )
    }, [scenarios])

    const colors = useMemo(() => getTagColors(), [evalautions])

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_EvaluationScenario>[] = []
        if (!scenarios.length || !evalautions.length) return colDefs

        colDefs.push({
            headerName: "Expected Output",
            minWidth: 280,
            flex: 1,
            field: "correct_answer",
            ...getFilterParams("text"),
            valueGetter: (params) => {
                return params.data?.correct_answer?.toString() || ""
            },
            pinned: "left",
            cellRenderer: LongTextCellRenderer,
        })

        evalautions.forEach((evalaution, vi) => {
            evalaution?.variants.forEach((variant, index) => {
                scenarios
                    .find((scenario) => scenario.evaluation.id === evalaution.id)
                    ?.inputs.forEach((input, index) => {
                        colDefs.push({
                            headerComponent: () => (
                                <Space>
                                    <span>Input: {input.name}</span>
                                    <Tag color={colors[vi]}> {variant.variantName}</Tag>
                                </Space>
                            ),
                            minWidth: 200,
                            flex: 1,
                            field: `inputs.${index}`,
                            ...getFilterParams(input.type === "number" ? "number" : "text"),
                            valueGetter: (params) => {
                                return getTypedValue(params.data?.inputs[index])
                            },
                            cellRenderer: LongTextCellRenderer,
                        })
                    })
                colDefs.push({
                    headerComponent: () => (
                        <Space>
                            <span>Output</span>
                            <Tag color={colors[vi]}>{variant.variantName}</Tag>
                        </Space>
                    ),
                    minWidth: 280,
                    flex: 1,
                    field: `outputs.${index}`,
                    ...getFilterParams("text"),
                    valueGetter: (params) => {
                        return getTypedValue(params.data?.outputs[index])
                    },
                    cellRenderer: LongTextCellRenderer,
                })
                evalaution.aggregated_results.forEach(({evaluator_config: config}) => {
                    colDefs.push({
                        flex: 1,
                        headerComponent: () => (
                            <Space>
                                <span>Evaluator: {config.name}</span>
                                <Tag color={colors[vi]}>{variant.variantName}</Tag>
                            </Space>
                        ),
                        field: "results",
                        ...getFilterParams("text"),
                        valueGetter: (params) => {
                            return getTypedValue(
                                params.data?.results.find(
                                    (item) => item.evaluator_config === config.id,
                                )?.result,
                            )
                        },
                    })
                })
            })
        })

        return colDefs
    }, [scenarios])

    const fetcher = () => {
        setFetching(true)
        Promise.all(
            (evaluationIds?.split(",") || []).map((evalId) =>
                fetchAllEvaluationScenarios(appId, evalId),
            ),
        )
            .then((scenariosNest) => {
                setScenarios(scenariosNest.flat(1))
                setTimeout(() => {
                    if (!gridRef.current) return

                    const ids: string[] =
                        gridRef.current.api
                            .getColumns()
                            ?.filter((column) => column.getColDef().field?.startsWith("results"))
                            ?.map((item) => item.getColId()) || []
                    gridRef.current.api.autoSizeColumns(ids, false)
                    setFetching(false)
                }, 100)
            })
            .catch(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [appId, evaluationIds])

    const handleDeleteVariant = (evalId: string) => {
        setEvaluationIds(
            evaluationIds
                ?.split(",")
                .filter((item) => item !== evalId)
                .join(","),
        )
    }

    const onExport = () => {
        if (!gridRef.current) return
        const {currentApp} = getAppValues()
        gridRef.current.api.exportDataAsCsv({
            fileName: `${currentApp?.app_name}_${evalautions
                .map(({variants}) => variants[0].variantName)
                .join("_")}.csv`,
        })
    }

    return (
        <div>
            <Typography.Title level={3}>Evaluations Comparison</Typography.Title>
            <div className={classes.infoRow}>
                <Space size="large">
                    <Space>
                        <Typography.Text strong>Testset:</Typography.Text>
                        <Typography.Text>{evalautions[0]?.testset.name || ""}</Typography.Text>
                    </Space>
                    <Space>
                        <Typography.Text strong>Variants:</Typography.Text>
                        <div>
                            {evalautions?.map(({variants, id}, vi) => (
                                <Tag
                                    key={id}
                                    color={colors[vi]}
                                    onClose={() => handleDeleteVariant(id)}
                                    closable
                                >
                                    {variants[0].variantName}
                                </Tag>
                            ))}
                        </div>
                    </Space>
                </Space>
                <Tooltip title="Export as CSV">
                    <DownloadOutlined onClick={onExport} style={{fontSize: 16}} />
                </Tooltip>
            </div>

            <Spin spinning={fetching}>
                <div
                    className={`${
                        appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"
                    } ${classes.table}`}
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

export default EvaluationCompareMode
