import React, {useEffect, useMemo, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {ColDef} from "ag-grid-community"
import {createUseStyles} from "react-jss"
import {Button, Dropdown, Space, Spin, Tag, Tooltip, theme} from "antd"
import {
    CheckOutlined,
    DeleteOutlined,
    PlusCircleOutlined,
    SlidersOutlined,
    SwapOutlined,
} from "@ant-design/icons"
import {EvaluationStatus, JSSTheme, _Evaluation} from "@/lib/Types"
import {uniqBy} from "lodash"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import duration from "dayjs/plugin/duration"
import NewEvaluationModal from "./NewEvaluationModal"
import {useAppId} from "@/hooks/useAppId"
import {deleteEvaluations, fetchAllEvaluations, fetchEvaluationStatus} from "@/services/evaluations"
import {useUpdateEffect} from "usehooks-ts"
import {shortPoll} from "@/lib/helpers/utils"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {
    DateFromNowRenderer,
    LinkCellRenderer,
    StatusRenderer,
    runningStatuses,
    statusMapper,
} from "../cellRenderers/cellRenderers"
import {useAtom} from "jotai"
import {evaluatorsAtom} from "@/lib/atoms/evaluation"
import AgCustomHeader from "@/components/AgCustomHeader/AgCustomHeader"
import {useRouter} from "next/router"
import EmptyEvaluations from "./EmptyEvaluations"
import {calcEvalDuration, getFilterParams, getTypedValue} from "@/lib/helpers/evaluate"
import Link from "next/link"
dayjs.extend(relativeTime)
dayjs.extend(duration)

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
    },
    table: {
        height: "calc(100vh - 260px)",
    },
    buttonsGroup: {
        marginTop: "1rem",
        alignSelf: "flex-end",
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

const EvaluationResults: React.FC<Props> = () => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const appId = useAppId()
    const [evaluations, setEvaluations] = useState<_Evaluation[]>([])
    const [evaluators] = useAtom(evaluatorsAtom)
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [fetching, setFetching] = useState(false)
    const [selected, setSelected] = useState<_Evaluation[]>([])
    const stoppers = useRef<Function>()
    const router = useRouter()
    const {token} = theme.useToken()
    const gridRef = useRef<AgGridReact>()
    const [hiddenCols, setHiddenCols] = useState<string[]>([])

    const runningEvaluationIds = useMemo(
        () =>
            evaluations
                .filter((item) => runningStatuses.includes(item.status.value))
                .map((item) => item.id),
        [evaluations],
    )

    const onDelete = () => {
        AlertPopup({
            title: "Delete Evaluations",
            message: `Are you sure you want to delete all ${selected.length} selected evaluations?`,
            onOk: () =>
                deleteEvaluations(selected.map((item) => item.id))
                    .catch(console.error)
                    .then(fetcher),
        })
    }

    const fetcher = () => {
        setFetching(true)
        fetchAllEvaluations(appId)
            .then(setEvaluations)
            .catch(console.error)
            .finally(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [appId])

    //update status of running evaluations through short polling
    useUpdateEffect(() => {
        stoppers.current?.()

        if (runningEvaluationIds.length) {
            stoppers.current = shortPoll(
                () =>
                    Promise.all(runningEvaluationIds.map((id) => fetchEvaluationStatus(id)))
                        .then((res) => {
                            setEvaluations((prev) => {
                                const newEvals = [...prev]
                                runningEvaluationIds.forEach((id, ix) => {
                                    const index = newEvals.findIndex((e) => e.id === id)
                                    if (index !== -1) {
                                        newEvals[index].status = res[ix].status
                                        newEvals[index].duration = calcEvalDuration(newEvals[index])
                                    }
                                })
                                if (
                                    res.some((item) => !runningStatuses.includes(item.status.value))
                                )
                                    fetcher()
                                return newEvals
                            })
                        })
                        .catch(console.error),
                {delayMs: 2000, timeoutMs: Infinity},
            ).stopper
        }

        return () => {
            stoppers.current?.()
        }
    }, [JSON.stringify(runningEvaluationIds)])

    const evaluatorConfigs = useMemo(
        () =>
            uniqBy(
                evaluations
                    .map((item) =>
                        item.aggregated_results.map((item) => ({
                            ...item.evaluator_config,
                            evaluator: evaluators.find(
                                (e) => e.key === item.evaluator_config.evaluator_key,
                            ),
                        })),
                    )
                    .flat(),
                "id",
            ),
        [evaluations],
    )

    const compareDisabled = useMemo(
        () =>
            selected.length < 2 ||
            selected.some(
                (item) =>
                    item.status.value === EvaluationStatus.STARTED ||
                    item.status.value === EvaluationStatus.INITIALIZED ||
                    item.testset.id !== selected[0].testset.id,
            ),
        [selected],
    )

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_Evaluation>[] = [
            {
                field: "variants",
                flex: 1,
                minWidth: 160,
                pinned: "left",
                headerCheckboxSelection: true,
                hide: hiddenCols.includes("Variant"),
                checkboxSelection: true,
                showDisabledCheckboxes: true,
                cellRenderer: (params: any) => {
                    const {revisions, variants} = params.data
                    return (
                        <Link
                            href={`/apps/${appId}/playground?variant=${variants[0].variantName}&revision=${revisions[0]}`}
                        >
                            {params.value}
                        </Link>
                    )
                },
                valueGetter: (params) =>
                    `${params.data?.variants[0].variantName} #${params.data?.revisions[0]}`,
                headerName: "Variant",
                tooltipValueGetter: (params) => params.data?.variants[0].variantName,
                ...getFilterParams("text"),
            },
            {
                field: "testset.name",
                hide: hiddenCols.includes("Testset"),
                headerName: "Testset",
                cellRenderer: (params: any) => (
                    <LinkCellRenderer
                        {...params}
                        href={`/apps/${appId}/testsets/${params.data?.testset.id}`}
                    />
                ),
                flex: 1,
                minWidth: 160,
                tooltipValueGetter: (params) => params.value,
                ...getFilterParams("text"),
            },
            ...evaluatorConfigs.map(
                (config) =>
                    ({
                        flex: 1,
                        minWidth: 190,
                        hide: hiddenCols.includes(config.name),
                        field: "aggregated_results",
                        headerName: config.name,
                        headerComponent: (props: any) => (
                            <AgCustomHeader {...props}>
                                <Space
                                    direction="vertical"
                                    size="small"
                                    style={{padding: "0.75rem 0"}}
                                >
                                    <Space size="small">
                                        <SlidersOutlined />
                                        <span>{config.name}</span>
                                    </Space>
                                    <Tag color={config.evaluator?.color}>
                                        {config.evaluator?.name}
                                    </Tag>
                                </Space>
                            </AgCustomHeader>
                        ),
                        autoHeaderHeight: true,
                        ...getFilterParams("number"),
                        valueGetter: (params) =>
                            getTypedValue(
                                params.data?.aggregated_results.find(
                                    (item) => item.evaluator_config.id === config.id,
                                )?.result,
                            ),
                        tooltipValueGetter: (params) =>
                            params.data?.aggregated_results
                                .find((item) => item.evaluator_config.id === config.id)
                                ?.result?.value?.toString() || "",
                    }) as ColDef<_Evaluation>,
            ),
            {
                flex: 1,
                headerName: "Status",
                hide: hiddenCols.includes("Status"),
                field: "status",
                minWidth: 185,
                pinned: "right",
                ...getFilterParams("text"),
                filterValueGetter: (params) =>
                    statusMapper(token)[params.data?.status.value as EvaluationStatus].label,
                cellRenderer: StatusRenderer,
            },
            {
                flex: 1,
                field: "average_latency",
                headerName: "Latency",
                minWidth: 120,
                ...getFilterParams("number"),
                valueGetter: (params) => getTypedValue(params?.data?.average_latency),
            },
            {
                flex: 1,
                field: "average_cost",
                headerName: "Cost",
                minWidth: 120,
                ...getFilterParams("number"),
                valueGetter: (params) => getTypedValue(params?.data?.average_cost),
            },
            {
                flex: 1,
                field: "created_at",
                headerName: "Created",
                hide: hiddenCols.includes("Created"),
                minWidth: 160,
                ...getFilterParams("date"),
                cellRenderer: DateFromNowRenderer,
                sort: "desc",
            },
        ]
        return colDefs
    }, [evaluatorConfigs, hiddenCols])

    const compareBtnNode = (
        <Button
            disabled={compareDisabled}
            icon={<SwapOutlined />}
            type="primary"
            data-cy="evaluation-results-compare-button"
            onClick={() =>
                router.push(
                    `/apps/${appId}/evaluations/compare/?evaluations=${selected
                        .map((item) => item.id)
                        .join(",")}`,
                )
            }
        >
            Compare
        </Button>
    )
    const onToggleEvaluatorVisibility = (evalConfigId: string) => {
        if (!hiddenCols.includes(evalConfigId)) {
            setHiddenCols([...hiddenCols, evalConfigId])
        } else {
            setHiddenCols(hiddenCols.filter((item) => item !== evalConfigId))
        }
    }

    const shownCols = useMemo(
        () =>
            colDefs
                .map((item) => item.headerName)
                .filter((item) => item !== undefined && !hiddenCols.includes(item)) as string[],
        [colDefs],
    )

    return (
        <>
            {!fetching && !evaluations.length ? (
                <EmptyEvaluations
                    onConfigureEvaluators={() =>
                        router.push(`/apps/${appId}/evaluations/new-evaluator`)
                    }
                    onBeginEvaluation={() => {
                        setNewEvalModalOpen(true)
                    }}
                />
            ) : (
                <div className={classes.root}>
                    <Space className={classes.buttonsGroup}>
                        <Button
                            disabled={selected.length === 0}
                            icon={<DeleteOutlined />}
                            type="primary"
                            data-cy="evaluation-results-delete-button"
                            danger
                            onClick={onDelete}
                        >
                            Delete
                        </Button>
                        {compareDisabled ? (
                            <Tooltip title="Select 2 or more evaluations from the same testset to compare">
                                {compareBtnNode}
                            </Tooltip>
                        ) : (
                            compareBtnNode
                        )}
                        <Button
                            icon={<PlusCircleOutlined />}
                            type="primary"
                            onClick={() => {
                                setNewEvalModalOpen(true)
                            }}
                            data-cy="new-evaluation-button"
                        >
                            New Evaluation
                        </Button>
                    </Space>

                    <Space className={classes.buttonsGroup}>
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                selectedKeys: shownCols,
                                items: colDefs.map((configs) => ({
                                    key: configs.headerName as string,
                                    label: (
                                        <Space>
                                            <CheckOutlined />
                                            <>{configs.headerName}</>
                                        </Space>
                                    ),
                                })),
                                onClick: ({key}) => onToggleEvaluatorVisibility(key),
                                className: classes.dropdownMenu,
                            }}
                        >
                            <Button>Filter Columns</Button>
                        </Dropdown>
                    </Space>

                    <Spin spinning={fetching}>
                        <div
                            className={`${
                                appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"
                            } ${classes.table}`}
                        >
                            <AgGridReact<_Evaluation>
                                ref={gridRef as any}
                                rowData={evaluations}
                                columnDefs={colDefs}
                                rowStyle={{
                                    cursor: "pointer",
                                }}
                                getRowId={(params) => params.data.id}
                                onRowClicked={(params) => {
                                    // ignore clicks on the checkbox col
                                    if (
                                        params.eventPath?.find(
                                            (item: any) => item.ariaColIndex === "1",
                                        )
                                    )
                                        return
                                    ;(EvaluationStatus.FINISHED === params.data?.status.value ||
                                        EvaluationStatus.FINISHED_WITH_ERRORS ===
                                            params.data?.status.value) &&
                                        router.push(`/apps/${appId}/evaluations/${params.data?.id}`)
                                }}
                                rowSelection="multiple"
                                suppressRowClickSelection
                                onSelectionChanged={(event) =>
                                    setSelected(event.api.getSelectedRows())
                                }
                                tooltipShowDelay={0}
                            />
                        </div>
                    </Spin>
                </div>
            )}
            <NewEvaluationModal
                open={newEvalModalOpen}
                onCancel={() => setNewEvalModalOpen(false)}
                onSuccess={() => {
                    setNewEvalModalOpen(false)
                    fetcher()
                }}
            />
        </>
    )
}

export default EvaluationResults
