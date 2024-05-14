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
import {Button, DropdownProps, Space, Spin, Tag, Tooltip, Typography} from "antd"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {getFilterParams, getTypedValue, removeCorrectAnswerPrefix} from "@/lib/helpers/evaluate"
import {getColorFromStr, getRandomColors} from "@/lib/helpers/colors"
import {CheckOutlined, CloseCircleOutlined, DownloadOutlined, UndoOutlined} from "@ant-design/icons"
import {getAppValues} from "@/contexts/app.context"
import {useQueryParam} from "@/hooks/useQuery"
import {LongTextCellRenderer} from "../cellRenderers/cellRenderers"
import Link from "next/link"
import AgCustomHeader from "@/components/AgCustomHeader/AgCustomHeader"
import {useAtom} from "jotai"
import {evaluatorsAtom} from "@/lib/atoms/evaluation"
import CompareOutputDiff from "@/components/CompareOutputDiff/CompareOutputDiff"
import {formatCurrency, formatLatency} from "@/lib/helpers/formatters"
import FilterColumns, {generateFilterItems} from "../FilterColumns/FilterColumns"
import _ from "lodash"

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
    dropdownMenu: {
        "&>.ant-dropdown-menu-item": {
            "& .anticon-check": {
                display: "none",
            },
        },
        "&>.ant-dropdown-menu-item-selected": {
            "&:not(:hover)": {
                backgroundColor: "transparent !important",
            },
            "& .anticon-check": {
                display: "inline-flex !important",
            },
        },
    },
}))

interface Props {}

const EvaluationCompareMode: React.FC<Props> = () => {
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const [evaluationIdsStr = ""] = useQueryParam("evaluations")
    const evaluationIdsArray = evaluationIdsStr.split(",").filter((item) => !!item)
    const [evalIds, setEvalIds] = useState(evaluationIdsArray)
    const [hiddenVariants, setHiddenVariants] = useState<string[]>([])
    const [fetching, setFetching] = useState(false)
    const [rows, setRows] = useState<ComparisonResultRow[]>([])
    const [testset, setTestset] = useState<TestSet>()
    const [evaluators] = useAtom(evaluatorsAtom)
    const gridRef = useRef<AgGridReact<_EvaluationScenario>>()
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
    const [isDiffDropdownOpen, setIsDiffDropdownOpen] = useState(false)
    const [selectedCorrectAnswer, setSelectedCorrectAnswer] = useState(["noDiffColumnIsSelected"])

    const handleOpenChangeDiff: DropdownProps["onOpenChange"] = (nextOpen, info) => {
        if (info.source === "trigger" || nextOpen) {
            setIsDiffDropdownOpen(nextOpen)
        }
    }

    const handleOpenChangeFilterCols: DropdownProps["onOpenChange"] = (nextOpen, info) => {
        if (info.source === "trigger" || nextOpen) {
            setIsFilterColsDropdownOpen(nextOpen)
        }
    }

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

    const colDefs = useMemo(() => {
        const colDefs: ColDef<ComparisonResultRow>[] = []
        const {inputs, variants} = rows[0] || {}

        if (!rows.length || !variants.length) return []

        inputs.forEach((input, ix) => {
            colDefs.push({
                headerName: `Input: ${input.name}`,
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
                minWidth: 200,
                flex: 1,
                field: `inputs.${ix}.value` as any,
                ...getFilterParams("text"),
                pinned: "left",
                cellRenderer: (params: any) => LongTextCellRenderer(params),
            })
        })

        Object.keys(rows[0])
            .filter((item) => item.startsWith("correctAnswer_"))
            .forEach((key) =>
                colDefs.push({
                    headerName: `${removeCorrectAnswerPrefix(key)}`,
                    hide: hiddenVariants.includes(`${removeCorrectAnswerPrefix(key)}`),
                    headerComponent: (props: any) => {
                        return (
                            <AgCustomHeader {...props}>
                                <Space direction="vertical" className="py-2">
                                    <span>{removeCorrectAnswerPrefix(key)}</span>
                                    <Tag color="green">Ground Truth</Tag>
                                </Space>
                            </AgCustomHeader>
                        )
                    },
                    minWidth: 280,
                    flex: 1,
                    field: key,
                    ...getFilterParams("text"),
                    cellRenderer: (params: any) => LongTextCellRenderer(params),
                }),
            )

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
                headerName: "Output",
                minWidth: 280,
                flex: 1,
                field: `variants.${vi}.output` as any,
                ...getFilterParams("text"),
                hide: hiddenVariants.includes("Output"),
                cellRenderer: (params: any) => {
                    return (
                        <>
                            {selectedCorrectAnswer[0] !== "noDiffColumnIsSelected"
                                ? LongTextCellRenderer(
                                      params,
                                      <CompareOutputDiff
                                          variantOutput={getTypedValue(
                                              params.data?.variants.find(
                                                  (item: any) =>
                                                      item.evaluationId === variant.evaluationId,
                                              )?.output?.result,
                                          )}
                                          expectedOutput={
                                              params.data[selectedCorrectAnswer[0]] || ""
                                          }
                                      />,
                                  )
                                : LongTextCellRenderer(
                                      params,
                                      getTypedValue(
                                          params.data?.variants.find(
                                              (item: any) =>
                                                  item.evaluationId === variant.evaluationId,
                                          )?.output?.result,
                                      ),
                                  )}
                        </>
                    )
                },
                valueGetter: (params) => {
                    return getTypedValue(
                        params.data?.variants.find(
                            (item) => item.evaluationId === variant.evaluationId,
                        )?.output?.result,
                    )
                },
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
                    minWidth: 200,
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
                    headerName: config.name,
                    field: "variants.0.evaluatorConfigs.0.result" as any,
                    ...getFilterParams("text"),
                    hide: hiddenVariants.includes(config.name),
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

        variants.forEach((variant, vi) => {
            colDefs.push({
                headerComponent: (props: any) => (
                    <AgCustomHeader {...props}>
                        <Space direction="vertical">
                            <span>Latency</span>
                            <Tag color={colors[vi]}>{variant.variantName}</Tag>
                        </Space>
                    </AgCustomHeader>
                ),
                hide: hiddenVariants.includes("Latency"),
                minWidth: 120,
                headerName: "Latency",
                flex: 1,
                valueGetter: (params) => {
                    const latency = params.data?.variants.find(
                        (item) => item.evaluationId === variant.evaluationId,
                    )?.output?.latency
                    return latency === undefined ? "-" : formatLatency(latency)
                },
                ...getFilterParams("text"),
            })
        })

        variants.forEach((variant, vi) => {
            colDefs.push({
                headerComponent: (props: any) => (
                    <AgCustomHeader {...props}>
                        <Space direction="vertical">
                            <span>Cost</span>
                            <Tag color={colors[vi]}>{variant.variantName}</Tag>
                        </Space>
                    </AgCustomHeader>
                ),
                headerName: "Cost",
                minWidth: 120,
                hide: !evalIds.includes(variant.evaluationId) || hiddenVariants.includes("Cost"),
                flex: 1,
                valueGetter: (params) => {
                    const cost = params.data?.variants.find(
                        (item) => item.evaluationId === variant.evaluationId,
                    )?.output?.cost
                    return cost === undefined ? "-" : formatCurrency(cost)
                },
                ...getFilterParams("text"),
            })
        })

        return colDefs
    }, [rows, hiddenVariants, evalIds, selectedCorrectAnswer])

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

    const handleToggleVariantVisibility = (evalId: string) => {
        if (!hiddenVariants.includes(evalId)) {
            setHiddenVariants([...hiddenVariants, evalId])
            setEvalIds(evalIds.filter((val) => val !== evalId))
        } else {
            setHiddenVariants(hiddenVariants.filter((item) => item !== evalId))
            if (evaluationIdsArray.includes(evalId)) {
                setEvalIds([...evalIds, evalId])
            }
        }
    }

    const shownCols = useMemo(
        () =>
            colDefs
                .map((item) => item.headerName)
                .filter((item) => item !== undefined && !hiddenVariants.includes(item)) as string[],
        [colDefs],
    )

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
                                        className={classes.tag}
                                        style={{
                                            opacity: hiddenVariants.includes(v.evaluationId)
                                                ? 0.4
                                                : 1,
                                        }}
                                        icon={
                                            evalIds.length < 2 &&
                                            evalIds.includes(
                                                v.evaluationId,
                                            ) ? null : evalIds.includes(v.evaluationId) ? (
                                                <CloseCircleOutlined
                                                    onClick={() =>
                                                        handleToggleVariantVisibility(
                                                            v.evaluationId,
                                                        )
                                                    }
                                                    style={{cursor: "pointer"}}
                                                />
                                            ) : (
                                                <UndoOutlined
                                                    onClick={() =>
                                                        handleToggleVariantVisibility(
                                                            v.evaluationId,
                                                        )
                                                    }
                                                    style={{cursor: "pointer"}}
                                                />
                                            )
                                        }
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
                    <FilterColumns
                        items={generateFilterItems(
                            _.uniqBy(
                                colDefs.filter((item) => !item.headerName?.startsWith("Input")),
                                "headerName",
                            ),
                        )}
                        isOpen={isFilterColsDropdownOpen}
                        handleOpenChange={handleOpenChangeFilterCols}
                        shownCols={shownCols}
                        onClick={({key}) => {
                            handleToggleVariantVisibility(key)
                            setIsFilterColsDropdownOpen(true)
                        }}
                    />
                    {!!rows.length && (
                        <div className="flex items-center gap-2">
                            <Typography.Text>Apply difference with: </Typography.Text>
                            <FilterColumns
                                items={Object.keys(rows[0])
                                    .filter((item) => item.startsWith("correctAnswer_"))
                                    .map((key) => ({
                                        key: key as string,
                                        label: (
                                            <Space>
                                                <CheckOutlined />
                                                <>{removeCorrectAnswerPrefix(key)}</>
                                            </Space>
                                        ),
                                    }))}
                                buttonText={removeCorrectAnswerPrefix(selectedCorrectAnswer[0])}
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
function formatCost(cost: any) {
    throw new Error("Function not implemented.")
}
