import React, {useMemo, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {ColDef, ICellRendererParams, ValueGetterParams} from "ag-grid-community"
import {createUseStyles} from "react-jss"
import {Button, Space} from "antd"
import {DeleteOutlined, PlusCircleOutlined, SlidersOutlined, SwapOutlined} from "@ant-design/icons"
import {_Evaluation} from "@/lib/Types"
import Mock from "./mock"
import {capitalize, uniqBy} from "lodash"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
dayjs.extend(relativeTime)

const useStyles = createUseStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
    },
    table: {
        height: 500,
    },
    buttonsGroup: {
        alignSelf: "flex-end",
    },
    statusCell: {
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",

        "& > div:nth-of-type(1)": {
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: "#52c41a",
        },
    },
    dot: {
        width: 3,
        height: 3,
        borderRadius: "50%",
        backgroundColor: "#444",
    },
})

interface Props {}

const EvaluationResults: React.FC<Props> = () => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const [rowData, setRowData] = useState<_Evaluation[]>(Mock.evaluations)

    const evaluatorConfigs = useMemo(
        () =>
            uniqBy(
                rowData
                    .map((item) => item.aggregated_results.map((item) => item.evaluator_config))
                    .flat(),
                "id",
            ),
        [rowData],
    )

    const [colDefs, setColDefs] = useState<ColDef<_Evaluation>[]>([
        {field: "testset.name"},
        {
            field: "variants",
            valueGetter: (params) => params.data?.variants[0].variantName,
            headerName: "Variant",
        },
        ...evaluatorConfigs.map(
            (config) =>
                ({
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
            field: "status",
            cellRenderer: (params: ICellRendererParams) => {
                const classes = useStyles()

                return (
                    <div className={classes.statusCell}>
                        <div />
                        <div>{capitalize(params.value)}</div>
                        <span className={classes.dot}></span>
                        <span>{(params.data?.duration || 0) / 1000}</span>
                    </div>
                )
            },
        },
        {
            field: "created_at",
            headerName: "Created",
            valueFormatter: (params) => dayjs(params.value).fromNow(),
        },
    ])

    return (
        <div className={classes.root}>
            <Space className={classes.buttonsGroup}>
                <Button icon={<DeleteOutlined />} type="primary" danger>
                    Delete
                </Button>
                <Button icon={<SwapOutlined />} type="primary">
                    Compare
                </Button>
                <Button icon={<PlusCircleOutlined />} type="primary">
                    New Evaluation
                </Button>
            </Space>
            <div
                className={`${appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"} ${
                    classes.table
                }`}
            >
                <AgGridReact<_Evaluation>
                    rowData={rowData}
                    columnDefs={colDefs}
                    getRowId={(params) => params.data.id}
                />
            </div>
        </div>
    )
}

export default EvaluationResults
