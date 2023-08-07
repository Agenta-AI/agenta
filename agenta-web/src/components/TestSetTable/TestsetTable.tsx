import React, {useState, useRef, useEffect} from "react"
import {AgGridReact} from "ag-grid-react"

import {Button, Input, Typography, message} from "antd"
import TestsetMusHaveNameModal from "./InsertTestsetNameModal"

import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {DeleteOutlined, PlusOutlined} from "@ant-design/icons"
import {createNewTestset, loadTestset, updateTestset} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import useBlockNavigation from "@/hooks/useBlockNavigation"
import {useUpdateEffect} from "usehooks-ts"
import useStateCallback from "@/hooks/useStateCallback"
import {AxiosResponse} from "axios"

type testsetTableProps = {
    mode: "create" | "edit"
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
    const gridRef = useRef(null)

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
                const newColumnDefs = [...columnDefs.slice(0, 1), ...columnsFromData]
                setColumnDefs(newColumnDefs)

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

    const handleInputChange = (index, event) => {
        const values = [...inputValues]
        values[index] = event.target.value
        setInputValues(values)
    }

    const updateTable = () => {
        const checkboxColumn = columnDefs.find((colDef) => colDef.field === "")
        const dataColumns = columnDefs.filter((colDef) => colDef.field !== "")

        const newDataColumns = inputValues.map((value, index) => {
            return {
                field: value || dataColumns[index]?.field || `newColumn${index}`,
            }
        })

        const newColumnDefs = [checkboxColumn, ...newDataColumns]

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

    const defaultColDef = {
        flex: 1,
        minWidth: 100,
        editable: true,
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

    const onAddColumn = () => {
        const newColumnName = `column${columnDefs.length}`
        // Update each row to include the new column
        const updatedRowData = rowData.map((row) => ({
            ...row,
            [newColumnName]: "", // set the initial value of the new column to an empty string
        }))
        setInputValues([...inputValues, newColumnName])
        setColumnDefs([...columnDefs, {field: newColumnName}])
        setRowData(updatedRowData)
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
                    width: "50%",
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
                />
                <Button onClick={() => onSaveData(true)} type="primary">
                    Save Test Set
                </Button>
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: "10px",
                }}
            >
                {inputValues.map((value, index) => (
                    <div key={index} style={{marginRight: "10px"}}>
                        <Input
                            value={value}
                            onChange={(event) => handleInputChange(index, event)}
                            suffix={
                                <Button
                                    type="text"
                                    icon={<DeleteOutlined />}
                                    onClick={() => onDeleteColumn(index)}
                                />
                            }
                        />
                    </div>
                ))}
                <Button onClick={onAddColumn} style={{marginRight: "10px"}}>
                    <PlusOutlined />
                </Button>
                <Button onClick={updateTable} type="primary">
                    Update Columns names
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
                    singleClickEdit={true}
                    rowSelection={"multiple"}
                    suppressRowClickSelection={true}
                    onCellValueChanged={handleCellValueChanged}
                    stopEditingWhenCellsLoseFocus={true}
                />
            </div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: "20px",
                }}
            >
                <div>
                    <Button onClick={onAddRow}>Add Row</Button>
                    <Button onClick={onDeleteRow} style={{marginLeft: 10}}>
                        Delete Row
                    </Button>
                </div>
            </div>

            <TestsetMusHaveNameModal isModalOpen={isModalOpen} setIsModalOpen={setIsModalOpen} />
        </div>
    )
}

export default TestsetTable
