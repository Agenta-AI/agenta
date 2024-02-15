import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {
    ComparisonResultRow,
    EvaluatorConfig,
    JSSTheme,
    TestSet,
    _Evaluation,
    _EvaluationScenario,
} from "@/lib/Types"
import {fetchAllComparisonResults} from "@/services/evaluations"
import {ColDef} from "ag-grid-community"
import {AgGridReact} from "ag-grid-react"
import {Button, Space, Spin, Switch, Tag, Tooltip, Typography} from "antd"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {getFilterParams, getTypedValue} from "@/lib/helpers/evaluate"
import {getColorFromStr, getRandomColors} from "@/lib/helpers/colors"
import {DownloadOutlined} from "@ant-design/icons"
import {getAppValues} from "@/contexts/app.context"
import {useQueryParam} from "@/hooks/useQuery"
import {LongTextCellRenderer} from "../cellRenderers/cellRenderers"
import Link from "next/link"
import AgCustomHeader from "@/components/AgCustomHeader/AgCustomHeader"
import {useAtom} from "jotai"
import {evaluatorsAtom} from "@/lib/atoms/evaluation"
import {diffSentences} from "diff"

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
            color: "inherit !important",
            fontWeight: 600,
            "&:hover": {
                color: "inherit !important",
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
    const [showDiff, setShowDiff] = useQueryParam("showDiff", "show")
    const [fetching, setFetching] = useState(false)
    const [rows, setRows] = useState<ComparisonResultRow[]>([])
    const [testset, setTestset] = useState<TestSet>()
    const [evaluators] = useAtom(evaluatorsAtom)
    const gridRef = useRef<AgGridReact<_EvaluationScenario>>()

    const variants = useMemo(() => {
        return rows[0]?.variants || []
    }, [rows])

    const colors = useMemo(() => {
        const previous = new Set<string>()
        const colors = getRandomColors()
        return variants.map((v) => {
            const color = getColorFromStr(v.evaluationId)
            if (previous.has(color)) return colors.find((c) => !previous.has(c))!
            previous.add(color)
            return color
        })
    }, [variants])

    const evaluationIds = useMemo(
        () => evaluationIdsStr.split(",").filter((item) => !!item),
        [evaluationIdsStr],
    )

    const compareStrings = (variantOutput1: any, variantOutput2: any) => {
        const results = diffSentences(variantOutput1, variantOutput2)

        const display = results.map((part, index) => {
            if (part.removed) {
                return (
                    <span
                        key={index}
                        style={{
                            backgroundColor: "#ccffd8",
                            color: "#000",
                        }}
                    >
                        {part.value}
                    </span>
                )
            } else if (!part.added) {
                return <span key={index}>{part.value}</span>
            } else if (part.added) {
                return (
                    <>
                        {" "}
                        <span
                            key={index}
                            style={{
                                backgroundColor: "#ff818266",
                                textDecoration: "line-through",
                                color: appTheme === "dark" ? "#fff" : "#000",
                            }}
                        >
                            {part.value}
                        </span>
                    </>
                )
            }
            return null
        })

        return <span>{display}</span>
    }

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
                headerComponent: (props: any) => (
                    <AgCustomHeader {...props}>
                        <Space direction="vertical">
                            <span>Output</span>
                            <Tag color={colors[vi]}>{variant.variantName}</Tag>
                        </Space>
                    </AgCustomHeader>
                ),
                minWidth: 280,
                flex: 1,
                field: `variants.${vi}.output` as any,
                ...getFilterParams("text"),
                valueGetter: (params) => {
                    return (
                        <>
                            {showDiff === "show" ? (
                                <span>
                                    {compareStrings(
                                        getTypedValue(
                                            params.data?.variants.find(
                                                (item) =>
                                                    item.evaluationId === variant.evaluationId,
                                            )?.output?.result,
                                        ),
                                        params.data?.correctAnswer,
                                    )}
                                </span>
                            ) : (
                                getTypedValue(
                                    params.data?.variants.find(
                                        (item) => item.evaluationId === variant.evaluationId,
                                    )?.output?.result,
                                )
                            )}
                        </>
                    )
                },
                cellRenderer: LongTextCellRenderer,
            })
        })

        const confgisMap: Record<
            string,
            {config: EvaluatorConfig; variant: ComparisonResultRow["variants"][0]; color: string}[]
        > = {}
        variants.forEach((variant, vi) => {
            variant.evaluatorConfigs.forEach(({evaluatorConfig: config}, ix) => {
                if (!confgisMap[config.id]) confgisMap[config.id] = []
                confgisMap[config.id].push({variant, config, color: colors[vi]})
            })
        })

        Object.entries(confgisMap).forEach(([_, configs]) => {
            configs.forEach(({config, variant, color}) => {
                colDefs.push({
                    flex: 1,
                    headerName: config.name,
                    headerComponent: (props: any) => {
                        const evaluator = evaluators.find(
                            (item) => item.key === config.evaluator_key,
                        )
                        return (
                            <AgCustomHeader {...props}>
                                <Space direction="vertical">
                                    <Space>
                                        <span>{config.name}</span>
                                        <Tag color={evaluator?.color}>{evaluator?.name}</Tag>
                                    </Space>
                                    <Tag color={color}>{variant.variantName}</Tag>
                                </Space>
                            </AgCustomHeader>
                        )
                    },
                    field: "variants.0.evaluatorConfigs.0.result" as any,
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
    }, [rows, showDiff, appTheme])

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
                <Space size={10}>
                    <Space>
                        <Typography.Text>Show Difference: </Typography.Text>
                        <Switch
                            value={showDiff === "show"}
                            onClick={() => setShowDiff(showDiff === "show" ? "hide" : "show")}
                        />
                    </Space>
                    <Tooltip title="Export as CSV">
                        <Button icon={<DownloadOutlined />} onClick={onExport}>
                            Export
                        </Button>
                    </Tooltip>
                </Space>
            </div>

            <Spin spinning={fetching}>
                <div
                    className={`${
                        appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"
                    } ${classes.table}`}
                    data-cy="evaluation-compare-table"
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
