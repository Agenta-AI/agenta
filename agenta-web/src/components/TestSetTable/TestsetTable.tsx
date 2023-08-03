import React, {useState, useRef, useEffect} from "react"
import {AgGridReact} from "ag-grid-react"

import {Button, Input, Typography} from "antd"
import TestsetMusHaveNameModal from "./InsertTestsetNameModal"

import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {ConsoleSqlOutlined, DeleteOutlined, PlusOutlined} from "@ant-design/icons"
import {createNewTestset, loadTestset, updateTestset} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useAppTheme} from "../Layout/ThemeContextProvider"

type testsetTableProps = {
    mode: "create" | "edit"
}

const TestsetTable: React.FC<testsetTableProps> = ({mode}) => {
    const router = useRouter()
    const appName = router.query.app_name?.toString() || ""
    const {testset_id} = router.query

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

    const [inputValues, setInputValues] = useState(
        columnDefs.filter((colDef) => colDef.field !== "").map((col) => col.field),
    )
    const gridRef = useRef(null)

    useEffect(() => {
        // If in edit mode, load the existing test set
        if (mode === "edit" && testset_id) {
            loadTestset(testset_id).then((data) => {
                setTestsetName(data.name)
                setRowData(data.csvdata)
                setColumnDefs(Object.keys(data.csvdata[0]).map((key) => ({field: key})))
            })
        }
    }, [mode, testset_id])

    useEffect(() => {
        // If in edit mode, load the existing test set
        if (mode === "edit" && testset_id) {
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
            })
        }
    }, [mode, testset_id])

    useEffect(() => {
        if (mode === "edit" && testset_id) {
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
                setInputValues(columnsFromData.map((colDef) => colDef.field))
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

    const onSaveData = async () => {
        try {
            let response
            if (mode === "create") {
                if (!testsetName) {
                    setIsModalOpen(true)
                } else {
                    response = await createNewTestset(appName, testsetName, rowData)
                    if (response.status === 200) {
                        router.push(`/apps/${appName}/testsets`)
                    }
                }
            } else if (mode === "edit") {
                if (!testsetName) {
                    setIsModalOpen(true)
                } else {
                    response = await updateTestset(testset_id, testsetName, rowData)
                    if (response.status === 200) {
                        router.push(`/apps/${appName}/testsets`)
                    }
                }
            }
        } catch (error) {
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
    }

    const {appTheme} = useAppTheme()

    return (
        <div>
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
                <Button onClick={onSaveData} type="primary">
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
