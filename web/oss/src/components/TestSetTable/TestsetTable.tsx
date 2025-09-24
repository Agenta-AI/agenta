// @ts-nocheck
import {type FC, type ChangeEvent, ReactNode, useEffect, useState, useMemo} from "react"

import {type IHeaderParams} from "@ag-grid-community/core"
import {Button, Input, Typography, message} from "antd"
import {NoticeType} from "antd/es/message/interface"
import {AxiosResponse} from "axios"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import useBlockNavigation from "@/oss/hooks/useBlockNavigation"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import useStateCallback from "@/oss/hooks/useStateCallback"
import useURL from "@/oss/hooks/useURL"
import AgGridReact, {type AgGridReactType} from "@/oss/lib/helpers/agGrid"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {GenericObject, KeyValuePair} from "@/oss/lib/Types"
import {fetchTestset, updateTestset} from "@/oss/services/testsets/api"
import {useProjectData} from "@/oss/state/project"
import {useTestsetsData} from "@/oss/state/testset"

import {useAppTheme} from "../Layout/ThemeContextProvider"

import EditRowModal from "./EditRowModal"
import TestsetMusHaveNameModal from "./InsertTestsetNameModal"
import TableCellsRenderer from "./TableCellsRenderer"
import TableHeaderComponent from "./TableHeaderComponent"

interface TestsetTableProps {
    mode: "edit"
}
export interface ColumnDefsType {
    field: string
    [key: string]: any
}

export const CHECKBOX_COL = {
    field: "",
    headerCheckboxSelection: true,
    checkboxSelection: true,
    showDisabledCheckboxes: true,
    maxWidth: 50,
    editable: false,
}

export const ADD_BUTTON_COL = {field: "", editable: false, maxWidth: 100}

const useStylesTestset = createUseStyles({
    title: {
        marginBottom: "20px !important",
        fontWeight: "500 !important",
    },
    inputContainer: {
        width: "100%",
        marginBottom: 20,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        "& input": {
            marginRight: "10px",
        },
    },
    notes: {
        marginBottom: 20,
        "& span": {
            display: "block",
        },
    },
    btnContainer: {
        display: "flex",
        alignItems: "center",
        marginTop: "20px",
        gap: 10,
    },
})

const TestsetTable: FC<TestsetTableProps> = ({mode}) => {
    const [messageApi, contextHolder] = message.useMessage()

    const mssgModal = (type: NoticeType, content: ReactNode) => {
        messageApi.open({
            type,
            content,
        })
    }

    const [unSavedChanges, setUnSavedChanges] = useStateCallback(false)
    const [isDataChanged, setIsDataChanged] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [testsetName, setTestsetName] = useState("")
    const [rowData, setRowData] = useState<KeyValuePair[]>([])
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [columnDefs, setColumnDefs] = useState<ColumnDefsType[]>([])
    const [inputValues, setInputValues] = useStateCallback(columnDefs.map((col) => col.field))
    const [focusedRowData, setFocusedRowData] = useState<GenericObject>()
    const [writeMode, setWriteMode] = useState(mode)
    const [gridRef, setGridRef] = useState<AgGridReactType["api"]>()

    const [selectedRow, setSelectedRow] = useState([])

    const classes = useStylesTestset()
    const router = useRouter()
    const {appTheme} = useAppTheme()
    const {isProjectId} = useProjectData()
    const {mutate: mutateTestsets} = useTestsetsData()
    const {projectURL} = useURL()

    const {testset_id} = router.query

    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                testsets: {label: "test sets", href: `${projectURL}/testsets`},
                "testset-detail": {label: testsetName, value: testset_id},
            },
            condition: testsetName.trim() && testset_id,
        },
        [testsetName],
    )

    useBlockNavigation(unSavedChanges, {
        title: "Unsaved changes",
        message:
            "You have unsaved changes in your test set. Do you want to save these changes before leaving the page?",
        okText: "Save",
        onOk: async () => {
            await onSaveData()
            return !!testsetName
        },
        cancelText: "Proceed without saving",
    })

    useLazyEffect(() => {
        if (isDataChanged) {
            setUnSavedChanges(true)
        }
    }, [rowData, testsetName, columnDefs, inputValues])

    useEffect(() => {
        async function applyColData(colData: {field: string}[] = []) {
            const newColDefs = createNewColDefs(colData)
            setColumnDefs(newColDefs)
            setInputValues(newColDefs.filter((col) => !!col.field).map((col) => col.field))
        }

        if (writeMode === "edit" && testset_id && isProjectId) {
            fetchTestset(testset_id as string).then((data) => {
                setTestsetName(data.name)
                if (data.csvdata.length > 0) {
                    applyColData(
                        Object.keys(data.csvdata[0]).map((key) => ({
                            field: key,
                        })),
                    )
                    setRowData(data.csvdata)
                }
            })
        }
    }, [writeMode, testset_id, isProjectId])

    const handleExportClick = () => {
        const csvData = convertToCsv(
            rowData,
            columnDefs.map((col) => col.field),
        )
        const filename = `${testsetName}.csv`
        downloadCsv(csvData, filename)
    }

    const createNewColDefs = (colData: {field: string}[] = []) => {
        return [
            CHECKBOX_COL,
            ...colData.map((col) => ({
                ...col,
                headerName: col.field,
            })),
            ADD_BUTTON_COL,
        ]
    }

    const updateTable = (inputValues: string[]) => {
        const dataColumns = columnDefs.filter((colDef) => colDef.field !== "")

        const newDataColumns = inputValues.map((value, index) => {
            return {
                field: value || dataColumns[index]?.field || `newColumn${index}`,
            }
        })

        const newColumnDefs = createNewColDefs(newDataColumns)

        const keyMap = dataColumns.reduce((acc: KeyValuePair, colDef, index) => {
            acc[colDef.field] = newDataColumns[index].field
            return acc
        }, {})

        const newRowData = rowData.map((row) => {
            const newRow: KeyValuePair = {}
            for (const key in row) {
                newRow[keyMap[key]] = row[key]
            }
            return newRow
        })

        setColumnDefs(newColumnDefs)

        setRowData(newRowData)
    }

    const onAddRow = () => {
        const newRow: KeyValuePair = {}
        columnDefs.forEach((colDef) => {
            if (colDef.field !== "") {
                newRow[colDef.field] = ""
            }
        })
        setRowData([...rowData, newRow])
        setIsDataChanged(true)
    }

    const onSaveData = async () => {
        try {
            setIsLoading(true)
            const afterSave = (response: AxiosResponse) => {
                if (response.status === 200) {
                    mutateTestsets()
                    setUnSavedChanges(false, () => {
                        mssgModal("success", "Changes saved successfully!")
                    })
                    setIsLoading(false)
                    setWriteMode("edit")
                }
            }

            if (writeMode === "edit") {
                if (!testsetName) {
                    setIsModalOpen(true)
                } else {
                    const response = await updateTestset(testset_id as string, testsetName, rowData)
                    afterSave(response)
                }
            }
        } catch (error) {
            console.error("Error saving test set:", error)
            setIsLoading(false)
        }
    }

    const onRowSelectedOrDeselected = () => {
        if (!gridRef) return
        const selectedNodes = gridRef?.getSelectedNodes()
        setSelectedRow(selectedNodes as any)
    }

    const onDeleteRow = () => {
        if (!gridRef) return
        const selectedNodes = gridRef.getSelectedNodes()
        const selectedData = selectedNodes.map((node: GenericObject) => node.data)
        const newrowData = rowData.filter((row) => !selectedData.includes(row))
        setRowData(newrowData)
        setIsDataChanged(true)
    }

    const onDeleteColumn = (indexToDelete: number) => {
        // Get the field to be deleted
        const fieldToDelete = columnDefs[indexToDelete + 1]?.field // +1 to skip checkbox column

        // Filter out the column and corresponding input value
        const newColumnDefs = columnDefs.filter((_, index) => index !== indexToDelete + 1) // +1 to skip checkbox column
        const newInputValues = inputValues.filter((_, index) => index !== indexToDelete)

        // Update the rowData to remove the field
        const newRowData = rowData.map((row) => {
            const newRow = {...row}
            delete newRow[fieldToDelete]
            return newRow
        })

        // Update the state
        setInputValues(newInputValues)
        setColumnDefs(newColumnDefs)
        setRowData(newRowData)
        setIsDataChanged(true)
    }

    const handleTestsetNameChange = (e: ChangeEvent<HTMLInputElement>) => {
        setTestsetName(e.target.value)
        setIsDataChanged(true)
    }

    const handleCellValueChanged = (params: GenericObject) => {
        if (params.newValue === null) {
            params.data[params.colDef.field] = ""
        }
        setUnSavedChanges(true)
        setIsDataChanged(true)
    }

    const defaultColDef = {
        flex: 1,
        minWidth: 100,
        editable: true,
        cellRenderer: TableCellsRenderer,
        cellRendererParams: {
            onEdit: (ix: number) => {
                setFocusedRowData(rowData[ix])
            },
        },
        headerComponent: (params: IHeaderParams) => (
            <TableHeaderComponent
                params={params}
                columnDefs={columnDefs}
                inputValues={inputValues}
                setRowData={setRowData}
                rowData={rowData}
                updateTable={updateTable}
                setInputValues={setInputValues}
                onDeleteColumn={onDeleteColumn}
                setColumnDefs={setColumnDefs}
                setIsDataChanged={setIsDataChanged}
            />
        ),
        resizable: true,
    }

    return (
        <div>
            {contextHolder}

            <Typography.Title level={5} className={classes.title}>
                Create a new Test Set
            </Typography.Title>

            <div className={classes.inputContainer}>
                <Input
                    value={testsetName}
                    onChange={handleTestsetNameChange}
                    placeholder="Test Set Name"
                />
                <Button loading={isLoading} onClick={() => onSaveData()} type="primary">
                    Save Test Set
                </Button>
            </div>

            <div className={classes.notes}>
                <Typography.Text italic>Notes:</Typography.Text>
                <Typography.Text italic>
                    - Specify column names similar to the Input parameters.
                </Typography.Text>
                <Typography.Text italic>
                    - A column with <strong>'correct_answer'</strong> name will be treated as a
                    ground truth column and could be used in evaluations.
                </Typography.Text>
            </div>

            <div
                className={`${appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"}`}
                style={{height: 500}}
            >
                <AgGridReact
                    onGridReady={(params) => setGridRef(params.api)}
                    rowData={rowData}
                    columnDefs={columnDefs}
                    defaultColDef={defaultColDef}
                    singleClickEdit={false}
                    rowSelection={"multiple"}
                    suppressRowClickSelection={true}
                    onCellValueChanged={handleCellValueChanged}
                    stopEditingWhenCellsLoseFocus={true}
                    onRowSelected={onRowSelectedOrDeselected}
                    onRowDataUpdated={onRowSelectedOrDeselected}
                    className="ph-no-capture"
                />
            </div>

            {selectedRow && (
                <div className={classes.btnContainer}>
                    <Button onClick={onAddRow}>Add Row</Button>
                    <Button onClick={onDeleteRow} disabled={selectedRow.length < 1}>
                        Delete Row{selectedRow.length > 1 && "s"}
                    </Button>
                    <Button onClick={handleExportClick}>Export as CSV</Button>
                </div>
            )}

            <TestsetMusHaveNameModal isModalOpen={isModalOpen} setIsModalOpen={setIsModalOpen} />

            <EditRowModal
                onCancel={() => setFocusedRowData(undefined)}
                data={focusedRowData}
                onCellValueChanged={handleCellValueChanged}
            />
        </div>
    )
}

export default TestsetTable
