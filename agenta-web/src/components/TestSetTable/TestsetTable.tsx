import React, {useState, useRef, useEffect} from "react"
import {AgGridReact} from "ag-grid-react"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {createUseStyles} from "react-jss"
import {Button, Input, Modal, Tooltip, Typography, message} from "antd"
import TestsetMusHaveNameModal from "./InsertTestsetNameModal"
import {DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons"
import {createNewTestset, loadTestset, updateTestset} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import useBlockNavigation from "@/hooks/useBlockNavigation"
import {useUpdateEffect} from "usehooks-ts"
import useStateCallback from "@/hooks/useStateCallback"
import {AxiosResponse} from "axios"
import EditRowModal from "./EditRowModal"

const useStyles = createUseStyles({
    cellContainer: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: "100%",

        "&:hover>:nth-child(2)": {
            display: "inline",
        },
    },
    cellValue: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flex: 1,
    },
    cellEditIcon: {
        display: "none",
    },
})

type testsetTableProps = {
    mode: "create" | "edit"
}

function CellRenderer(props: any) {
    const classes = useStyles()
    const cellValue = props.valueFormatted ? props.valueFormatted : props.value

    return props.colDef.field ? (
        <span
            className={classes.cellContainer}
            onClick={() =>
                props.api.startEditingCell({
                    rowIndex: props.node.rowIndex,
                    colKey: props.colDef.field,
                })
            }
        >
            <span className={classes.cellValue}>{cellValue || ""}</span>
            <span className={classes.cellEditIcon}>
                <Tooltip title="Edit in focused mode">
                    <EditOutlined
                        onClick={() => props.colDef?.cellRendererParams?.onEdit(props.rowIndex)}
                    />
                </Tooltip>
            </span>
        </span>
    ) : undefined
}

const TestsetTable: React.FC<testsetTableProps> = ({mode}) => {
    const [messageApi, contextHolder] = message.useMessage()

    const mssgModal = (type, content) => {
        messageApi.open({
            type,
            content,
        })
    }

    const router = useRouter()
    const appName = router.query.app_name?.toString() || ""
    const {testset_id} = router.query
    const [unSavedChanges, setUnSavedChanges] = useStateCallback(false)
    const [loading, setLoading] = useState(false)
    const [testsetName, setTestsetName] = useState("")
    const [rowData, setRowData] = useState([
        {column1: "data1"},
        {column1: "data1"},
        {column1: "data1"},
    ])
    const emptyData = {field: "", editable: false}
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [columnDefs, setColumnDefs] = useState([
        {
            field: "",
            headerCheckboxSelection: true,
            checkboxSelection: true,
            showDisabledCheckboxes: true,
            maxWidth: 50,
            editable: false,
        },
        {field: "column1"},
    ])
    const [inputValues, setInputValues] = useStateCallback(
        columnDefs.filter((colDef) => colDef.field !== "").map((col) => col.field),
    )
    const [focusedRowData, setFocusedRowData] = useState<Record<string, any>>()
    const gridRef = useRef(null)

    const [selectedRow, setSelectedRow] = useState([])

    const onRowSelectedOrDeselected = () => {
        if (!gridRef?.current) return
        setSelectedRow(gridRef?.current?.getSelectedNodes())
    }

    useBlockNavigation(unSavedChanges, {
        title: "Unsaved changes",
        message:
            "You have unsaved changes in your test set. Do you want to save these changes before leaving the page?",
        okText: "Save",
        onOk: async () => {
            await onSaveData(false)
            return !!testsetName
        },
        cancelText: "Proceed without saving",
    })

    useUpdateEffect(() => {
        if (!loading) {
            setUnSavedChanges(true)
        }
    }, [rowData, testsetName, columnDefs, inputValues])

    useEffect(() => {
        if (mode === "edit" && testset_id) {
            setLoading(true)
            loadTestset(testset_id).then((data) => {
                setTestsetName(data.name)
                setRowData(data.csvdata)

                // Create the column definitions from the data keys
                const columnsFromData = Object.keys(data.csvdata[0]).map((key) => ({
                    field: key,
                }))

                // Merge with the existing column definitions (the checkbox column)
                const newColumnDefs = [...columnDefs.slice(0, 1), ...columnsFromData, emptyData]

                setColumnDefs([...newColumnDefs])

                // Update input values for column names
                setInputValues(
                    columnsFromData.map((colDef) => colDef.field),
                    () => {
                        //set loading to false after the initial state has been settled
                        setTimeout(() => {
                            setLoading(false)
                        }, 100)
                    },
                )
            })
        }
    }, [mode, testset_id])

    const updateTable = (inputValues: string[]) => {
        const checkboxColumn = columnDefs.find((colDef) => colDef.field === "")
        const dataColumns = columnDefs.filter((colDef) => colDef.field !== "")

        const newDataColumns = inputValues.map((value, index) => {
            return {
                field: value || dataColumns[index]?.field || `newColumn${index}`,
            }
        })

        const newColumnDefs = [checkboxColumn, ...newDataColumns, emptyData]

        const keyMap = dataColumns.reduce((acc, colDef, index) => {
            acc[colDef.field] = newDataColumns[index].field
            return acc
        }, {})

        const newRowData = rowData.map((row) => {
            const newRow = {}
            for (let key in row) {
                newRow[keyMap[key]] = row[key]
            }
            return newRow
        })

        setColumnDefs(newColumnDefs)

        setRowData(newRowData)
        if (gridRef.current) {
            gridRef.current.setColumnDefs(newColumnDefs)
        }
    }

    const HeaderComponent = (params: any) => {
        const {eGridHeader} = params
        const [scopedInputValues, setScopedInputValues] = useState(
            columnDefs.filter((colDef) => colDef.field !== "").map((col) => col.field),
        )
        const [index, setIndex] = useState(eGridHeader.attributes[4].nodeValue - 2)

        const [displayName, setDisplayName] = useState(
            inputValues[eGridHeader.attributes[4].nodeValue - 2],
        )

        const [error, setError] = useState<string | undefined>(undefined)

        const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false)
        const handleOpenIsEditModalOpen = () => {
            setIsEditModalOpen(true)
        }

        const handleCloseIsEditModalOpen = () => {
            setScopedInputValues(inputValues)
            setIsEditModalOpen(false)
        }

        const handleSave = () => {
            if (inputValues.includes(scopedInputValues[index])) {
                setError("Column name already exist!")
            } else {
                setError(undefined)
                setInputValues(scopedInputValues)
                updateTable(scopedInputValues)
            }
        }

        const handleInputChange = (index, event) => {
            const values = [...inputValues]
            values[index] = event.target.value
            setScopedInputValues(values)
        }

        const onAddColumn = () => {
            const newColumnName = `column${columnDefs.length - 1}`
            // Update each row to include the new column
            const updatedRowData = rowData.map((row) => ({
                ...row,
                [newColumnName]: "", // set the initial value of the new column to an empty string
            }))

            setInputValues([...inputValues, newColumnName])
            setColumnDefs([...columnDefs, {field: newColumnName}])
            setRowData(updatedRowData)
        }

        useEffect(() => {
            setScopedInputValues(inputValues)
        }, [columnDefs])

        if (displayName === undefined) {
            return (
                <Button onClick={onAddColumn} style={{marginRight: "10px"}}>
                    <PlusOutlined />
                </Button>
            )
        } else {
            return (
                <>
                    <div
                        style={{
                            width: "100%",
                            height: "100% ",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }}
                    >
                        {displayName}
                        <div>
                            <Button
                                type="text"
                                icon={<EditOutlined />}
                                onClick={handleOpenIsEditModalOpen}
                            />
                            <Button
                                type="text"
                                icon={<DeleteOutlined />}
                                onClick={() => onDeleteColumn(index)}
                            />
                        </div>
                    </div>
                    <Modal
                        open={isEditModalOpen}
                        title="Edit column name"
                        onCancel={handleCloseIsEditModalOpen}
                        onOk={handleSave}
                    >
                        {error && <p style={{fontSize: "10px", color: "red"}}>{error}</p>}
                        <Input
                            value={scopedInputValues[index]}
                            onChange={(event) => handleInputChange(index, event)}
                            size="small"
                            style={{
                                marginTop: "10px",
                                marginBottom: "10px",
                                height: "30px",
                            }}
                        />
                    </Modal>
                </>
            )
        }
    }

    const defaultColDef = {
        flex: 1,
        minWidth: 100,
        editable: true,
        cellRenderer: CellRenderer,
        cellRendererParams: {
            onEdit: (ix: number) => {
                setFocusedRowData(rowData[ix])
            },
        },
        headerComponent: HeaderComponent,
        resizable: true,
    }

    const onAddRow = () => {
        const newRow = {}
        columnDefs.forEach((colDef) => {
            if (colDef.field !== "") {
                newRow[colDef.field] = ""
            }
        })
        setRowData([...rowData, newRow])
    }

    const onSaveData = async (redirect = true) => {
        try {
            const afterSave = (response: AxiosResponse) => {
                if (response.status === 200) {
                    setUnSavedChanges(false, () => {
                        if (redirect) {
                            router.push(`/apps/${appName}/testsets`)
                        }
                    })
                }
            }

            if (mode === "create") {
                if (!testsetName) {
                    setIsModalOpen(true)
                } else {
                    const response = await createNewTestset(appName, testsetName, rowData)
                    afterSave(response)
                }
            } else if (mode === "edit") {
                if (!testsetName) {
                    setIsModalOpen(true)
                } else {
                    const response = await updateTestset(testset_id, testsetName, rowData)
                    afterSave(response)
                }
            }
        } catch (error) {
            mssgModal("error", "Error saving test set")
            console.error("Error saving test set:", error)
            throw error
        }
    }

    const handleChange = (e) => {
        setTestsetName(e.target.value)
    }

    const onDeleteRow = () => {
        const selectedNodes = gridRef.current.getSelectedNodes()
        const selectedData = selectedNodes.map((node) => node.data)
        const newrowData = rowData.filter((row) => !selectedData.includes(row))
        setRowData(newrowData)
    }

    const onDeleteColumn = (indexToDelete) => {
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
        if (gridRef.current) {
            gridRef.current.setColumnDefs(newColumnDefs)
        }
    }

    const handleCellValueChanged = (params) => {
        if (params.newValue === null) {
            params.data[params.colDef.field] = ""
        }
        setUnSavedChanges(true)
    }

    const {appTheme} = useAppTheme()

    return (
        <div>
            {contextHolder}

            <Typography.Title level={5} style={{marginBottom: "20px"}}>
                Create a new Test Set
            </Typography.Title>

            <div
                style={{
                    width: "100%",
                    marginBottom: 20,
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                }}
            >
                <Input
                    value={testsetName}
                    onChange={handleChange}
                    style={{marginRight: "10px"}}
                    placeholder="Test Set Name"
                    data-cy="testset-name-input"
                />
                <Button
                    data-cy="testset-save-button"
                    onClick={() => onSaveData(true)}
                    type="primary"
                >
                    Save Test Set
                </Button>
            </div>

            <div style={{marginBottom: 20}}>
                <div>
                    <Typography.Text italic>Notes:</Typography.Text>
                </div>
                <div>
                    <Typography.Text italic>
                        - Specify column names similar to the Input parameters.
                    </Typography.Text>
                </div>
                <div>
                    <Typography.Text italic>- A column with </Typography.Text>
                    <Typography.Text strong>'correct_answer'</Typography.Text>
                    <Typography.Text>
                        {" "}
                        name will be treated as a ground truth column and could be used in
                        evaluations.
                    </Typography.Text>
                </div>
            </div>

            <div
                className={`${appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"}`}
                style={{height: 500}}
            >
                <AgGridReact
                    onGridReady={(params) => (gridRef.current = params.api)}
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
                />
            </div>
            {selectedRow && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "20px",
                    }}
                >
                    <div>
                        <Button onClick={onAddRow}>Add Row</Button>
                        <Button
                            onClick={onDeleteRow}
                            style={{marginLeft: 10}}
                            disabled={selectedRow.length < 1}
                        >
                            Delete Row{selectedRow.length > 1 ? "s" : null}
                        </Button>
                    </div>
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
