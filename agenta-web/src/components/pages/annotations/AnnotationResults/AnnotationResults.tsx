import React, {useEffect, useMemo, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import {Button, Space, Spin, Tooltip, Typography} from "antd"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {createUseStyles} from "react-jss"
import {_Annotation, JSSTheme} from "@/lib/Types"
import {DeleteOutlined, PlusCircleOutlined, SwapOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"
import NewAnnotationModal from "./NewAnnotationModal"
import {fetchAllAnnotations} from "@/services/annotations"
import {ColDef} from "ag-grid-community"
import Link from "next/link"
import {DateFromNowRenderer, LinkCellRenderer} from "../../evaluations/cellRenderers/cellRenderers"
import {getFilterParams} from "@/lib/helpers/evaluate"
import {EvaluationType} from "@/lib/enums"

const {Title} = Typography

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
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
}))

const AnnotationResults = () => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const appId = useAppId()
    const router = useRouter()
    const [newAnnotationModalOpen, setNewAnnotationModalOpen] = useState(false)
    const [annotations, setAnnotations] = useState<_Annotation[]>([])
    const [selected, setSelected] = useState<_Annotation[]>([])
    const [fetching, setFetching] = useState(false)
    const gridRef = useRef<AgGridReact>()
    const singleModelAnnotation = annotations.filter(
        (annotation) => annotation.evaluation_type === EvaluationType.single_model_test,
    )
    const abTestingAnnotation = annotations.filter(
        (annotation) => annotation.evaluation_type === EvaluationType.human_a_b_testing,
    )

    const fetcher = () => {
        setFetching(true)
        fetchAllAnnotations(appId)
            .then(setAnnotations)
            .catch(console.error)
            .finally(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [appId])

    const colDefs = useMemo(() => {
        const colDefs: ColDef<_Annotation>[] = [
            {
                field: "testset_name",
                headerName: "Testset",
                cellRenderer: (params: any) => (
                    <LinkCellRenderer
                        {...params}
                        href={`/apps/${appId}/testsets/${params.data.testset_name}`}
                    />
                ),
                flex: 1,
                minWidth: 160,
                tooltipValueGetter: (params) => params.value,
                ...getFilterParams("text"),
            },
            {
                field: "variant_names",
                flex: 1,
                minWidth: 160,
                pinned: "left",
                headerCheckboxSelection: true,
                checkboxSelection: true,
                showDisabledCheckboxes: true,
                cellRenderer: (params: any) => {
                    const {revisions, variant_names} = params.data
                    return (
                        <Link
                            href={`/apps/${appId}/playground?variant=${variant_names[0]}&revision=${revisions[0]}`}
                        >
                            {params.value}
                        </Link>
                    )
                },
                valueGetter: (params) =>
                    `${params.data?.variant_names[0]} #${params.data?.revisions[0]}`,
                headerName: "Variant",
                tooltipValueGetter: (params) => params.data?.variant_names[0],
                ...getFilterParams("text"),
            },
            {
                field: "status",
                headerName: "Score",
                minWidth: 160,
                tooltipValueGetter: (params) => params.value,
                ...getFilterParams("text"),
            },
            {
                field: "status",
                headerName: "Status",
                minWidth: 160,
                tooltipValueGetter: (params) => params.value,
                ...getFilterParams("text"),
            },
            {
                field: "user_username",
                headerName: "User",
                flex: 1,
                minWidth: 160,
                tooltipValueGetter: (params) => params.value,
                ...getFilterParams("text"),
            },
            {
                flex: 1,
                field: "created_at",
                headerName: "Created",
                minWidth: 160,
                ...getFilterParams("date"),
                cellRenderer: DateFromNowRenderer,
                sort: "desc",
            },
            {
                flex: 1,
                headerName: "Action",
                minWidth: 160,
                cellRenderer: (params: any) => {
                    const {revisions, variant_names} = params.data
                    return <Button type="link">View evaluation</Button>
                },
            },
        ]
        return colDefs
    }, [])

    const compareBtnNode = (
        <Button
            // disabled={compareDisabled}
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

    const renderAnnotation = (annotation: _Annotation[], title: string) => {
        return (
            <div className={classes.root}>
                <Space className={classes.buttonsGroup}>
                    <Title level={2}>{title}</Title>
                    <Space>
                        <Button
                            // disabled={selected.length === 0}
                            icon={<DeleteOutlined />}
                            type="primary"
                            danger
                        >
                            Delete
                        </Button>
                        {/* {compareDisabled ? ( */}
                        <Tooltip title="Select 2 or more evaluations from the same testset to compare">
                            {compareBtnNode}
                        </Tooltip>
                        {/* ) : (
                    compareBtnNode
                )} */}
                        <Button
                            icon={<PlusCircleOutlined />}
                            type="primary"
                            onClick={() => {
                                setNewAnnotationModalOpen(true)
                            }}
                            data-cy="new-evaluation-button"
                        >
                            New Evaluation
                        </Button>
                    </Space>
                </Space>
                <Spin spinning={fetching}>
                    <div
                        className={`${
                            appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"
                        } ${classes.table}`}
                    >
                        <AgGridReact<_Annotation>
                            ref={gridRef as any}
                            rowData={annotation}
                            columnDefs={colDefs}
                            getRowId={(params) => params.data.id}
                            // onRowClicked={(params) => {
                            //     // ignore clicks on the checkbox col
                            //     if (
                            //         params.eventPath?.find(
                            //             (item: any) => item.ariaColIndex === "1",
                            //         )
                            //     )
                            //         return
                            //     ;(EvaluationStatus.FINISHED === params.data?.status.value ||
                            //         EvaluationStatus.FINISHED_WITH_ERRORS ===
                            //             params.data?.status.value) &&
                            //         router.push(`/apps/${appId}/evaluations/${params.data?.id}`)
                            // }}
                            rowSelection="multiple"
                            suppressRowClickSelection
                            onSelectionChanged={(event) => setSelected(event.api.getSelectedRows())}
                            tooltipShowDelay={0}
                        />
                    </div>
                </Spin>
            </div>
        )
    }

    return (
        <>
            {renderAnnotation(singleModelAnnotation, "Single Model Evaluation")}
            {renderAnnotation(abTestingAnnotation, "A/B Testing Evaluation")}

            <NewAnnotationModal
                open={newAnnotationModalOpen}
                onCancel={() => setNewAnnotationModalOpen(false)}
                onSuccess={() => {
                    setNewAnnotationModalOpen(false)
                    fetcher()
                }}
            />
        </>
    )
}

export default AnnotationResults
