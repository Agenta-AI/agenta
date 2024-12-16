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
import {type ColDef, type ICellRendererParams} from "@ag-grid-community/core"
import {fetchAllComparisonResults} from "@/services/evaluations/api"
import {Button, DropdownProps, Space, Spin, Tag, Tooltip, Typography} from "antd"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {getFilterParams, getTypedValue, removeCorrectAnswerPrefix} from "@/lib/helpers/evaluate"
import {getColorPairFromStr, getRandomColors} from "@/lib/helpers/colors"
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
import uniqBy from "lodash/uniqBy"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {escapeNewlines} from "@/lib/helpers/fileManipulations"
import EvaluationErrorModal from "../EvaluationErrorProps/EvaluationErrorModal"
import EvaluationErrorText from "../EvaluationErrorProps/EvaluationErrorText"
import {getStringOrJson} from "@/lib/helpers/utils"
import AgGridReact, {type AgGridReactType} from "@/lib/helpers/agGrid"

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
    const [scenarios, setScenarios] = useState<_Evaluation[]>([])
    const [rows, setRows] = useState<ComparisonResultRow[]>([])
    const [testset, setTestset] = useState<TestSet>()
    const [evaluators] = useAtom(evaluatorsAtom)
    const [gridRef, setGridRef] = useState<AgGridReactType<ComparisonResultRow>>()
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
    const [isDiffDropdownOpen, setIsDiffDropdownOpen] = useState(false)
    const [selectedCorrectAnswer, setSelectedCorrectAnswer] = useState(["noDiffColumnIsSelected"])
    const [modalErrorMsg, setModalErrorMsg] = useState({message: "", stackTrace: ""})
    const [isErrorModalOpen, setIsErrorModalOpen] = useState(false)

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
            const {textColor} = getColorPairFromStr(v.evaluationId)
            if (previous.has(textColor)) return colors.find((c) => !previous.has(c))!
            previous.add(textColor)
            return textColor
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
                minWidth: 300,
                flex: 1,
                field: `variants.${vi}.output` as any,
                ...getFilterParams("text"),
                hide: hiddenVariants.includes("Output"),
                cellRenderer: (params: ICellRendererParams<ComparisonResultRow>) => {
                    const result = params.data?.variants.find(
                        (item: any) => item.evaluationId === variant.evaluationId,
                    )?.output?.result

                    if (result && result.error && result.type == "error") {
                        return (
                            <EvaluationErrorText
                                text="Failed to invoke LLM app"
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

                    return (
                        <>
                            {selectedCorrectAnswer[0] !== "noDiffColumnIsSelected"
                                ? LongTextCellRenderer(
                                      params,
                                      <CompareOutputDiff
                                          variantOutput={getStringOrJson(result?.value)}
                                          expectedOutput={
                                              params.data
                                                  ? params.data[selectedCorrectAnswer[0]]
                                                  : ""
                                          }
                                      />,
                                  )
                                : LongTextCellRenderer(params, getStringOrJson(result?.value))}
                        </>
                    )
                },
                valueGetter: (params) => {
                    return getStringOrJson(
                        params.data?.variants.find(
                            (item) => item.evaluationId === variant.evaluationId,
                        )?.output?.result.value,
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
            configs.forEach(({config, variant, color}, idx) => {
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
                    type: `evaluator_${idx}`,
                    field: "variants.0.evaluatorConfigs.0.result" as any,
                    ...getFilterParams("text"),
                    hide: hiddenVariants.includes(config.name),
                    cellRenderer: (params: ICellRendererParams<ComparisonResultRow>) => {
                        const result = params.data?.variants
                            .find((item) => item.evaluationId === variant.evaluationId)
                            ?.evaluatorConfigs.find(
                                (item) => item.evaluatorConfig.id === config.id,
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
                            <Typography.Text>{getTypedValue(result)}</Typography.Text>
                        )
                    },
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
                field: `latency.${vi}` as any,
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
                field: `cost.${vi}` as any,
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
    }, [rows, hiddenVariants, evalIds, selectedCorrectAnswer, colors, evaluators])

    const fetcher = () => {
        setFetching(true)
        fetchAllComparisonResults(evaluationIds)
            .then(({rows, testset, evaluations}) => {
                setScenarios(evaluations)
                setRows(rows)
                setTestset(testset)
                setTimeout(() => {
                    if (!gridRef) return

                    const ids: string[] =
                        gridRef.api
                            .getColumns()
                            ?.filter((column) => column.getColDef().field?.endsWith("result"))
                            ?.map((item) => item.getColId()) || []
                    gridRef.api.autoSizeColumns(ids, false)
                    setFetching(false)
                }, 100)
            })
            .catch(() => setFetching(false))
    }

    useEffect(() => {
        if (!gridRef) return
        fetcher()
    }, [appId, evaluationIdsStr, gridRef])

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
        [colDefs, hiddenVariants],
    )

    const getDynamicHeaderName = (params: ColDef): string => {
        const {headerName, field, type}: any = params

        const getVariantNameWithRev = (index: number): string => {
            const scenario = scenarios[index]
            const variantName = scenario?.variants[0]?.variantName ?? ""
            const revision = scenario?.revisions[0] ?? ""
            return variantNameWithRev({variant_name: variantName, revision})
        }

        if (headerName === "Output" || headerName === "Latency" || headerName === "Cost") {
            const index = Number(field.split(".")[1])
            return `${headerName} ${getVariantNameWithRev(index)}`
        }

        if (type && type.startsWith("evaluator")) {
            const index = Number(type.split("_")[1])
            return `${headerName} ${getVariantNameWithRev(index)}`
        }

        return headerName
    }

    const onExport = (): void => {
        const gridApi = gridRef?.api
        if (!gridApi) return

        const {currentApp} = getAppValues()
        const fileName = `${currentApp?.app_name ?? "export"}_${variants.map(({variantName}) => variantName).join("_")}.csv`

        gridApi.exportDataAsCsv({
            fileName,
            processHeaderCallback: (params) => getDynamicHeaderName(params.column.getColDef()),
            processCellCallback: (params) =>
                typeof params.value === "string" ? escapeNewlines(params.value) : params.value,
        })
    }

    return (
        <div>
            <Typography.Title level={3}>Evaluations Comparison</Typography.Title>
            <div className={classes.infoRow}>
                <Space size="large">
                    <Space>
                        <Typography.Text strong>Testset:</Typography.Text>
                        <Typography.Link href={`/testsets/${testset?.id}`}>
                            {testset?.name || ""}
                        </Typography.Link>
                    </Space>
                    <Spin spinning={fetching}>
                        <Space>
                            <Typography.Text strong>Variants:</Typography.Text>
                            <div>
                                {scenarios?.map((v, vi) => (
                                    <Tag
                                        key={evaluationIds[vi]}
                                        color={colors[vi]}
                                        className={classes.tag}
                                        style={{
                                            opacity: hiddenVariants.includes(v.id) ? 0.4 : 1,
                                        }}
                                        icon={
                                            evalIds.length < 2 &&
                                            evalIds.includes(v.id) ? null : evalIds.includes(
                                                  v.id,
                                              ) ? (
                                                <CloseCircleOutlined
                                                    onClick={() =>
                                                        handleToggleVariantVisibility(v.id)
                                                    }
                                                    style={{cursor: "pointer"}}
                                                />
                                            ) : (
                                                <UndoOutlined
                                                    onClick={() =>
                                                        handleToggleVariantVisibility(v.id)
                                                    }
                                                    style={{cursor: "pointer"}}
                                                />
                                            )
                                        }
                                    >
                                        <Link
                                            href={`/apps/${appId}/playground?variant=${v.variants[0].variantName}`}
                                        >
                                            {variantNameWithRev({
                                                variant_name: v.variants[0].variantName ?? "",
                                                revision: v.revisions[0],
                                            })}
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
                            uniqBy(
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
                                buttonText={
                                    removeCorrectAnswerPrefix(selectedCorrectAnswer[0]) ===
                                    "noDiffColumnIsSelected"
                                        ? "Select Ground Truth"
                                        : removeCorrectAnswerPrefix(selectedCorrectAnswer[0])
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
                        gridRef={setGridRef}
                        rowData={rows}
                        columnDefs={colDefs}
                        getRowId={(params) => params.data.rowId}
                        headerHeight={64}
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

export default EvaluationCompareMode
function formatCost(cost: any) {
    throw new Error("Function not implemented.")
}
