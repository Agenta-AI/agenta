import React, {useEffect, useMemo, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {ColDef, ICellRendererParams} from "ag-grid-community"
import {createUseStyles} from "react-jss"
import {Button, GlobalToken, Space, Spin, Typography, theme} from "antd"
import {DeleteOutlined, PlusCircleOutlined, SlidersOutlined, SwapOutlined} from "@ant-design/icons"
import {EvaluationStatus, JSSTheme, _Evaluation} from "@/lib/Types"
import {uniqBy} from "lodash"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import duration from "dayjs/plugin/duration"
import NewEvaluationModal from "./NewEvaluationModal"
import {useAppId} from "@/hooks/useAppId"
import {deleteEvaluations, fetchAllEvaluations, fetchEvaluationStatus} from "@/services/evaluations"
import {useRouter} from "next/router"
import {useUpdateEffect} from "usehooks-ts"
import {durationToStr, shortPoll} from "@/lib/helpers/utils"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {useDurationCounter} from "@/hooks/useDurationCounter"
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
    statusCell: {
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        height: "100%",
        marginBottom: 0,

        "& > div:nth-of-type(1)": {
            height: 6,
            aspectRatio: 1 / 1,
            borderRadius: "50%",
        },
    },
    dot: {
        height: 3,
        aspectRatio: 1 / 1,
        borderRadius: "50%",
        backgroundColor: "#8c8c8c",
        marginTop: 2,
    },
    date: {
        color: "#8c8c8c",
    },
}))

const statusMapper = (token: GlobalToken) => ({
    [EvaluationStatus.INITIALIZED]: {
        label: "Queued",
        color: token.colorTextSecondary,
    },
    [EvaluationStatus.STARTED]: {
        label: "Running",
        color: token.colorWarning,
    },
    [EvaluationStatus.FINISHED]: {
        label: "Completed",
        color: token.colorSuccess,
    },
    [EvaluationStatus.ERROR]: {
        label: "Failed",
        color: token.colorError,
    },
})

interface Props {}

const EvaluationResults: React.FC<Props> = () => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const appId = useAppId()
    const router = useRouter()
    const [evaluations, setEvaluations] = useState<_Evaluation[]>([])
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [fetching, setFetching] = useState(false)
    const [selected, setSelected] = useState<_Evaluation[]>([])
    const stoppers = useRef<Function>()
    const {token} = theme.useToken()

    const runningEvaluationIds = useMemo(
        () =>
            evaluations
                .filter((item) =>
                    [EvaluationStatus.INITIALIZED, EvaluationStatus.STARTED].includes(item.status),
                )
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
                                    }
                                })
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
                    .map((item) => item.aggregated_results.map((item) => item.evaluator_config))
                    .flat(),
                "id",
            ),
        [evaluations],
    )

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_Evaluation>[] = [
            {
                minWidth: 280,
                field: "id",
                flex: 1,
                headerCheckboxSelection: true,
                checkboxSelection: true,
                showDisabledCheckboxes: true,
            },
            {field: "testset.name", flex: 1, minWidth: 160},
            {
                field: "variants",
                flex: 1,
                minWidth: 160,
                valueGetter: (params) =>
                    params.data?.variants.map((item) => item.variantName).join(","),
                headerName: "Variant",
            },
            ...evaluatorConfigs.map(
                (config) =>
                    ({
                        flex: 1,
                        minWidth: 140,
                        field: "aggregated_results",
                        headerComponent: () => (
                            <span>
                                <SlidersOutlined /> {config.name}
                            </span>
                        ),
                        valueGetter: (params) =>
                            params.data?.aggregated_results.find(
                                (item) => item.evaluator_config.id === config.id,
                            )?.result?.value || "",
                    }) as ColDef<_Evaluation>,
            ),
            {
                flex: 1,
                field: "status",
                minWidth: 200,
                cellRenderer: (params: ICellRendererParams<_Evaluation>) => {
                    const classes = useStyles()
                    const duration = useDurationCounter(
                        params.data?.duration || 0,
                        [EvaluationStatus.STARTED, EvaluationStatus.INITIALIZED].includes(
                            params.value,
                        ),
                    )
                    const {label, color} = statusMapper(token)[params.value as EvaluationStatus]

                    return (
                        <Typography.Text className={classes.statusCell}>
                            <div style={{backgroundColor: color}} />
                            <span>{label}</span>
                            <span className={classes.dot}></span>
                            <span className={classes.date}>{duration}</span>
                        </Typography.Text>
                    )
                },
            },
            {
                flex: 1,
                field: "created_at",
                headerName: "Created",
                minWidth: 120,
                valueFormatter: (params) => dayjs(params.value).fromNow(),
            },
        ]
        return colDefs
    }, [evaluatorConfigs])

    return (
        <div className={classes.root}>
            <Space className={classes.buttonsGroup}>
                <Button
                    disabled={selected.length === 0}
                    icon={<DeleteOutlined />}
                    type="primary"
                    danger
                    onClick={onDelete}
                >
                    Delete
                </Button>
                <Button
                    disabled={
                        selected.length < 2 ||
                        selected.some(
                            (item) =>
                                [EvaluationStatus.INITIALIZED, EvaluationStatus.STARTED].includes(
                                    item.status,
                                ) || item.testset.id !== selected[0].testset.id,
                        )
                    }
                    icon={<SwapOutlined />}
                    type="primary"
                    onClick={() =>
                        router.push(
                            `/apps/${appId}/evaluations-new/compare/?evaluations=${selected
                                .map((item) => item.id)
                                .join(",")}`,
                        )
                    }
                >
                    Compare
                </Button>
                <Button
                    icon={<PlusCircleOutlined />}
                    type="primary"
                    onClick={() => setNewEvalModalOpen(true)}
                >
                    New Evaluation
                </Button>
            </Space>
            <Spin spinning={fetching}>
                <div
                    className={`${
                        appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"
                    } ${classes.table}`}
                >
                    <AgGridReact<_Evaluation>
                        rowData={evaluations}
                        columnDefs={colDefs}
                        getRowId={(params) => params.data.id}
                        onRowClicked={(params) =>
                            router.push(`/apps/${appId}/evaluations-new/${params.data?.id}`)
                        }
                        rowSelection="multiple"
                        suppressRowClickSelection
                        onSelectionChanged={(event) => setSelected(event.api.getSelectedRows())}
                    />
                </div>
            </Spin>

            <NewEvaluationModal
                open={newEvalModalOpen}
                onCancel={() => setNewEvalModalOpen(false)}
                onSuccess={() => {
                    setNewEvalModalOpen(false)
                    fetcher()
                }}
            />
        </div>
    )
}

export default EvaluationResults
