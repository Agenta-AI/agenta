import {useState, useEffect} from "react"
import {DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Input, message} from "antd"
import {createUseStyles} from "react-jss"
import {ADD_BUTTON_COL} from "./TestsetTable"
import {KeyValuePair} from "@/lib/Types"
import {ColumnDefsType} from "./TestsetTable"

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
})

type TableHeaderComponentProps = {
    params: any
    columnDefs: ColumnDefsType[]
    inputValues: string[]
    rowData: KeyValuePair[]
    setColumnDefs: React.Dispatch<React.SetStateAction<ColumnDefsType[]>>
    setInputValues: React.Dispatch<React.SetStateAction<string[]>>
    setRowData: React.Dispatch<React.SetStateAction<KeyValuePair[]>>
    setIsDataChanged: React.Dispatch<React.SetStateAction<boolean>>
    updateTable: (inputValues: string[]) => void
    onDeleteColumn: (indexToDelete: number) => void
}

const TableHeaderComponent = ({
    params,
    columnDefs,
    inputValues,
    rowData,
    setColumnDefs,
    setInputValues,
    setRowData,
    setIsDataChanged,
    updateTable,
    onDeleteColumn,
}: TableHeaderComponentProps) => {
    const [scopedInputValues, setScopedInputValues] = useState(
        columnDefs.filter((colDef) => colDef.field !== "").map((col) => col.field),
    )
    const [isEditInputOpen, setIsEditInputOpen] = useState<boolean>(false)

    const {attributes} = params.eGridHeader
    const index = attributes["aria-colindex"].nodeValue - 2
    const displayName = params.displayName

    const classes = useStylesTestset()

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

    const handleSave = () => {
        if (scopedInputValues[index] == inputValues[index]) {
            setIsEditInputOpen(false)
            return
        }

        if (
            inputValues.some((input) => input === scopedInputValues[index]) ||
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
            setIsDataChanged(true)
        }
    }

    const handleInputChange = (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
        const values = [...inputValues]
        values[index] = event.target.value
        setScopedInputValues(values)
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
        setColumnDefs([
            ...columnDefs,
            {field: newColumnName, headerName: newColumnName},
            ADD_BUTTON_COL,
        ])
        setRowData(updatedRowData)
        setIsDataChanged(true)
    }

    if (displayName === "" && params.column?.colId !== "0") {
        return (
            <div className={classes.plusIcon}>
                <Button onClick={onAddColumn}>
                    <PlusOutlined />
                </Button>
            </div>
        )
    } else if (displayName === "" && params.column?.colId === "0") {
        return null
    } else {
        return (
            <div className={classes.columnTitle}>
                {isEditInputOpen ? (
                    <Input
                        value={scopedInputValues[index]}
                        onChange={(event) => handleInputChange(index, event)}
                        size="small"
                        data-cy="testset-header-column-edit-input"
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
                            data-cy="testset-header-column-save-button"
                        />
                    ) : (
                        <Button
                            icon={<EditOutlined />}
                            onClick={() => setIsEditInputOpen(true)}
                            type="text"
                            data-cy="testset-header-column-edit-button"
                        />
                    )}

                    <Button
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={() => onDeleteColumn(index)}
                    />
                </div>
            </div>
        )
    }
}

export default TableHeaderComponent
