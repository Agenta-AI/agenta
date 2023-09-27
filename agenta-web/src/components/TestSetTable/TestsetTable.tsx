import React, {useState, useRef, useEffect, ReactNode} from "react"
import {AgGridReact} from "ag-grid-react"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {createUseStyles} from "react-jss"
import {Button, Input, Tooltip, Typography, message} from "antd"
import TestsetMusHaveNameModal from "./InsertTestsetNameModal"
import {DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons"
import {createNewTestset, fetchVariants, loadTestset, updateTestset} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import useBlockNavigation from "@/hooks/useBlockNavigation"
import {useUpdateEffect} from "usehooks-ts"
import useStateCallback from "@/hooks/useStateCallback"
import {AxiosResponse} from "axios"
import EditRowModal from "./EditRowModal"
import {getVariantInputParameters} from "@/lib/helpers/variantHelper"
import {convertToCsv, downloadCsv} from "../../lib/helpers/utils"
import {NoticeType} from "antd/es/message/interface"
import {GenericObject, KeyValuePair} from "@/lib/Types"

type testsetTableProps = {
    mode: "create" | "edit"
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

const useStylesCell = createUseStyles({
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

const useStylesTestset = createUseStyles({
    plusIcon: {
        width: "100%",
        display: "flex",
        justifyContent: "end",
        "& button": {
            marginRight: "10px",
        },
    },
    columnTitle: {
        width: "100%",
        height: "100% ",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& input": {
            marginTop: "10px",
            marginBottom: "10px",
            height: "30px",
            marginRight: "3px",
            outline: "red",
        },
    },
    saveBtn: {
        width: "45px !important",
    },
    title: {
        marginBottom: "20px !important",
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
    },
    btnContainer: {
        display: "flex",
        alignItems: "center",
        marginTop: "20px",
        gap: 10,
    },
})

function CellRenderer(props: any) {
    const classes = useStylesCell()
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

    const mssgModal = (type: NoticeType, content: ReactNode) => {
        messageApi.open({
            type,
            content,
        })
    }

    const classes = useStylesTestset()
    const router = useRouter()
    const appId = router.query.app_id as string
    const {testset_id} = router.query
    const [unSavedChanges, setUnSavedChanges] = useStateCallback(false)
    const [loading, setLoading] = useState(false)
    const [testsetName, setTestsetName] = useState("")
    const [rowData, setRowData] = useState<KeyValuePair[]>([])
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [columnDefs, setColumnDefs] = useState<{field: string; [key: string]: any}[]>([])
    const [inputValues, setInputValues] = useStateCallback(columnDefs.map((col) => col.field))
    const [focusedRowData, setFocusedRowData] = useState<GenericObject>()
    const gridRef = useRef<any>(null)

    const [selectedRow, setSelectedRow] = useState([])

    const onRowSelectedOrDeselected = () => {
        if (!gridRef?.current) return
        setSelectedRow(gridRef?.current?.getSelectedNodes())
    }

    const handleExportClick = () => {
        const csvData = convertToCsv(
            rowData,
            columnDefs.map((col) => col.field),
        )
        const filename = `${testsetName}.csv`
        downloadCsv(csvData, filename)
    }

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

    useUpdateEffect(() => {
        if (!loading) {
            setUnSavedChanges(true)
        }
    }, [rowData, testsetName, columnDefs, inputValues])

    useEffect(() => {
        async function applyColData(colData: {field: string}[] = []) {
            const newColDefs = [CHECKBOX_COL, ...colData, ADD_BUTTON_COL]
            setColumnDefs(newColDefs)
            if (mode === "create") {
                const initialRowData = Array(3).fill({})
                const separateRowData = initialRowData.map(() => {
                    return colData.reduce((acc, curr) => ({...acc, [curr.field]: ""}), {})
                })

                setRowData(separateRowData)
            }
            setInputValues(newColDefs.filter((col) => !!col.field).map((col) => col.field))
        }

        if (mode === "edit" && testset_id) {
            setLoading(true)
            loadTestset(testset_id as string).then((data) => {
                setTestsetName(data.name)
                setRowData(data.csvdata)
                applyColData(
                    Object.keys(data.csvdata[0]).map((key) => ({
                        field: key,
                    })),
                )
            })
        } else if (mode === "create" && appId) {
            setLoading(true)
            ;(async () => {
                const backendVariants = await fetchVariants(appId)
                const variant =
                    backendVariants.find((v) => v.previousVariantName === null) ||
                    backendVariants[0]
                const inputParams = await getVariantInputParameters(appId, variant)
                const colData = inputParams.map((param) => ({field: param.name}))
                colData.push({field: "correct_answer"})

                applyColData(colData)
            })().catch(() => {
                applyColData([])
            })
        }
    }, [mode, testset_id, appId])

    const updateTable = (inputValues: string[]) => {
        const dataColumns = columnDefs.filter((colDef) => colDef.field !== "")

        const newDataColumns = inputValues.map((value, index) => {
            return {
                field: value || dataColumns[index]?.field || `newColumn${index}`,
            }
        })

        const newColumnDefs = [CHECKBOX_COL, ...newDataColumns, ADD_BUTTON_COL]

        const keyMap = dataColumns.reduce((acc: KeyValuePair, colDef, index) => {
            acc[colDef.field] = newDataColumns[index].field
            return acc
        }, {})

        const newRowData = rowData.map((row) => {
            const newRow: KeyValuePair = {}
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
        const {attributes} = params.eGridHeader
        const [scopedInputValues, setScopedInputValues] = useState(
            columnDefs.filter((colDef) => colDef.field !== "").map((col) => col.field),
        )
        const [index, setIndex] = useState(attributes["aria-colindex"].nodeValue - 2)

        const [displayName, setDisplayName] = useState(params.displayName)

        const [isEditInputOpen, setIsEditInputOpen] = useState<boolean>(false)
        const handleOpenEditInput = () => {
            setIsEditInputOpen(true)
        }

        const handleSave = () => {
            if (scopedInputValues[index] == inputValues[index]) {
                setIsEditInputOpen(false)

                return
            }

            if (
                inputValues.some(
                    (input) => input.toLowerCase() === scopedInputValues[index].toLowerCase(),
                ) ||
                scopedInputValues[index] == ""
            ) {
                message.error(
                    scopedInputValues[index] == ""
                        ? "Invalid column name"
                        : "Column name already exist!",
                )
            } else {
                setInputValues(scopedInputValues)
                updateTable(scopedInputValues)
                setIsEditInputOpen(false)
            }
        }

        const handleInputChange = (index: number, event: any) => {
            const values = [...inputValues]
            values[index] = event.target.value
            setScopedInputValues(values)
            setLoading(false)
        }

        const onAddColumn = () => {
            const newColumnName = `column${columnDefs.length - 1}`
            const newColmnDef = columnDefs
            const updatedRowData = rowData.map((row) => ({
                ...row,
                [newColumnName]: "",
            }))

            newColmnDef.pop()

            setInputValues([...inputValues, newColumnName])
            setColumnDefs([...columnDefs, {field: newColumnName}, ADD_BUTTON_COL])
            setRowData(updatedRowData)
            setLoading(false)
        }

        useEffect(() => {
            setScopedInputValues(inputValues)
        }, [columnDefs])

        useEffect(() => {
            const handleEscape = (e: KeyboardEvent) => {
                if (e.key == "Enter") {
                    if (isEditInputOpen) {
                        handleSave()
                    }
                }
            }
            window.addEventListener("keydown", handleEscape)
            return () => window.removeEventListener("keydown", handleEscape)
        }, [isEditInputOpen, scopedInputValues])

        if (displayName === "") {
            return (
                <div className={classes.plusIcon}>
                    <Button onClick={onAddColumn}>
                        <PlusOutlined />
                    </Button>
                </div>
            )
        } else {
            return (
                <>
                    <div className={classes.columnTitle}>
                        {isEditInputOpen ? (
                            <Input
                                value={scopedInputValues[index]}
                                onChange={(event) => handleInputChange(index, event)}
                                size="small"
                            />
                        ) : (
                            displayName
                        )}

                        <div>
                            {isEditInputOpen ? (
                                <Button
                                    icon="Save"
                                    onClick={handleSave}
                                    type="default"
                                    className={classes.saveBtn}
                                />
                            ) : (
                                <Button
                                    icon={<EditOutlined />}
                                    onClick={handleOpenEditInput}
                                    type="text"
                                />
                            )}

                            <Button
                                type="text"
                                icon={<DeleteOutlined />}
                                onClick={() => onDeleteColumn(index)}
                            />
                        </div>
                    </div>
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
        const newRow: KeyValuePair = {}
        columnDefs.forEach((colDef) => {
            if (colDef.field !== "") {
                newRow[colDef.field] = ""
            }
        })
        setRowData([...rowData, newRow])
        setLoading(false)
    }

    const onSaveData = async () => {
        try {
            const afterSave = (response: AxiosResponse) => {
                if (response.status === 200) {
                    setUnSavedChanges(false, () => {
                        mssgModal("success", "Changes saved successfully!")
                    })
                }
            }

            if (mode === "create") {
                if (!testsetName) {
                    setIsModalOpen(true)
                } else {
                    const response = await createNewTestset(appId, testsetName, rowData)
                    afterSave(response)
                }
            } else if (mode === "edit") {
                if (!testsetName) {
                    setIsModalOpen(true)
                } else {
                    const response = await updateTestset(testset_id as string, testsetName, rowData)
                    afterSave(response)
                }
            }
        } catch (error) {
            console.error("Error saving test set:", error)
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTestsetName(e.target.value)
        setLoading(false)
    }

    const onDeleteRow = () => {
        const selectedNodes = gridRef.current.getSelectedNodes()
        const selectedData = selectedNodes.map((node: GenericObject) => node.data)
        const newrowData = rowData.filter((row) => !selectedData.includes(row))
        setRowData(newrowData)
        setLoading(false)
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
        setLoading(false)
        if (gridRef.current) {
            gridRef.current.setColumnDefs(newColumnDefs)
        }
    }

    const handleCellValueChanged = (params: GenericObject) => {
        if (params.newValue === null) {
            params.data[params.colDef.field] = ""
        }
        setUnSavedChanges(true)
        setLoading(false)
    }

    const {appTheme} = useAppTheme()

    return (
        <div>
            {contextHolder}

            <Typography.Title level={5} className={classes.title}>
                Create a new Test Set
            </Typography.Title>

            <div className={classes.inputContainer}>
                <Input
                    value={testsetName}
                    onChange={handleChange}
                    placeholder="Test Set Name"
                    data-cy="testset-name-input"
                />
                <Button data-cy="testset-save-button" onClick={() => onSaveData()} type="primary">
                    Save Test Set
                </Button>
            </div>

            <div className={classes.notes}>
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
                <div className={classes.btnContainer}>
                    <Button onClick={onAddRow}>Add Row</Button>
                    <Button onClick={onDeleteRow} disabled={selectedRow.length < 1}>
                        Delete Row{selectedRow.length > 1 ? "s" : null}
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
