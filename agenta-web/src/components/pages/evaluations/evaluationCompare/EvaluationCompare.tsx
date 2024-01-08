import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {ComparisonResultRow, JSSTheme, TestSet, _Evaluation, _EvaluationScenario} from "@/lib/Types"
import {fetchAllComparisonResults} from "@/services/evaluations"
import {ColDef} from "ag-grid-community"
import {AgGridReact} from "ag-grid-react"
import {Space, Spin, Tag, Tooltip, Typography} from "antd"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {getFilterParams, getTypedValue} from "../evaluationResults/EvaluationResults"
import {getTagColors} from "@/lib/helpers/colors"
import {DownloadOutlined} from "@ant-design/icons"
import {getAppValues} from "@/contexts/app.context"
import {useQueryParam} from "@/hooks/useQuery"
import {LongTextCellRenderer} from "../cellRenderers/cellRenderers"
import {stringToNumberInRange} from "@/lib/helpers/utils"
import Link from "next/link"

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
    tag: {
        "& a": {
            color: "inherit",
            "&:hover": {
                color: "inherit",
                textDecoration: "underline",
            },
        },
    },
}))

interface Props {}

const EvaluationCompareMode: React.FC<Props> = () => {
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const [evaluationIdsStr = "", setEvaluationIdsStr] = useQueryParam("evaluations")
    const [fetching, setFetching] = useState(false)
    const [rows, setRows] = useState<ComparisonResultRow[]>([])
    const [testset, setTestset] = useState<TestSet>()
    const gridRef = useRef<AgGridReact<_EvaluationScenario>>()

    const variants = useMemo(() => {
        return rows[0]?.variants || []
    }, [rows])

    const colors = useMemo(() => {
        const colors = getTagColors()
        return variants.map(
            (v) => colors[stringToNumberInRange(v.evaluationId, 0, colors.length - 1)],
        )
    }, [variants])

    const evaluationIds = useMemo(
        () => evaluationIdsStr.split(",").filter((item) => !!item),
        [evaluationIdsStr],
    )

    const colDefs = useMemo(() => {
        const colDefs: ColDef<ComparisonResultRow>[] = []
        const {inputs, variants} = rows[0] || {}

        if (!rows.length || !variants.length) return []

        inputs.forEach((ip, ix) => {
            colDefs.push({
                headerName: `Input: ${ip.name}`,
                minWidth: 200,
                flex: 1,
                field: `inputs.${ix}.value` as any,
                ...getFilterParams("text"),
                pinned: "left",
                cellRenderer: LongTextCellRenderer,
            })
        })

        colDefs.push({
            headerName: "Expected Output",
            minWidth: 280,
            flex: 1,
            field: "correctAnswer",
            ...getFilterParams("text"),
            pinned: "left",
            cellRenderer: LongTextCellRenderer,
        })

        variants.forEach((variant, vi) => {
            colDefs.push({
                headerComponent: () => (
                    <Space direction="vertical">
                        <span>Output</span>
                        <Tag color={colors[vi]}>{variant.variantName}</Tag>
                    </Space>
                ),
                minWidth: 280,
                flex: 1,
                field: `variants.${vi}.output` as any,
                ...getFilterParams("text"),
                valueGetter: (params) => {
                    return getTypedValue(
                        params.data?.variants.find(
                            (item) => item.evaluationId === variant.evaluationId,
                        )?.output,
                    )
                },
                cellRenderer: LongTextCellRenderer,
            })
            variant.evaluatorConfigs.forEach(({evaluatorConfig: config}, ix) => {
                colDefs.push({
                    flex: 1,
                    headerComponent: () => (
                        <Space direction="vertical">
                            <span>Evaluator: {config.name}</span>
                            <Tag color={colors[vi]}>{variant.variantName}</Tag>
                        </Space>
                    ),
                    field: `variants.${vi}.evaluatorConfigs.${ix}.result` as any,
                    ...getFilterParams("text"),
                    valueGetter: (params) => {
                        return getTypedValue(
                            params.data?.variants
                                .find((item) => item.evaluationId === variant.evaluationId)
                                ?.evaluatorConfigs.find(
                                    (item) => item.evaluatorConfig.id === config.id,
                                )?.result,
                        )
                    },
                })
            })
        })

        return colDefs
    }, [rows])

    const fetcher = () => {
        setFetching(true)
        fetchAllComparisonResults(evaluationIds)
            .then(({rows, testset}) => {
                setRows(rows)
                setTestset(testset)
                setTimeout(() => {
                    if (!gridRef.current) return

                    const ids: string[] =
                        gridRef.current.api
                            .getColumns()
                            ?.filter((column) => column.getColDef().field?.endsWith("result"))
                            ?.map((item) => item.getColId()) || []
                    gridRef.current.api.autoSizeColumns(ids, false)
                    setFetching(false)
                }, 100)
            })
            .catch(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [appId, evaluationIdsStr])

    const handleDeleteVariant = (evalId: string) => {
        setEvaluationIdsStr(evaluationIds.filter((item) => item !== evalId).join(","))
    }

    const onExport = () => {
        if (!gridRef.current) return
        const {currentApp} = getAppValues()
        gridRef.current.api.exportDataAsCsv({
            fileName: `${currentApp?.app_name}_${variants
                .map(({variantName}) => variantName)
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
                        <Typography.Link href={`/apps/${appId}/testsets/${testset?.id}`}>
                            {testset?.name || ""}
                        </Typography.Link>
                    </Space>
                    <Spin spinning={fetching}>
                        <Space>
                            <Typography.Text strong>Variants:</Typography.Text>
                            <div>
                                {variants?.map((v, vi) => (
                                    <Tag
                                        key={evaluationIds[vi]}
                                        color={colors[vi]}
                                        onClose={() => handleDeleteVariant(v.evaluationId)}
                                        closable={evaluationIds.length > 1}
                                        className={classes.tag}
                                    >
                                        <Link
                                            href={`/apps/${appId}/playground/?variant=${v.variantName}`}
                                        >
                                            {v.variantName}
                                        </Link>
                                    </Tag>
                                ))}
                            </div>
                        </Space>
                    </Spin>
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
                    <AgGridReact<ComparisonResultRow>
                        ref={gridRef as any}
                        rowData={rows}
                        columnDefs={colDefs}
                        getRowId={(params) => params.data.id}
                        headerHeight={64}
                    />
                </div>
            </Spin>
        </div>
    )
}

export default EvaluationCompareMode
