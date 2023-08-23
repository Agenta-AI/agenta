import {capitalize} from "@/lib/helpers/utils"
import {AgGridReact} from "ag-grid-react"
import {Input, Modal} from "antd"
import React, {forwardRef, useCallback, useImperativeHandle, useMemo, useState} from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import useResizeObserver from "@/hooks/useResizeObserver"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    cellContainer: {
        lineHeight: "22px",
        display: "inline-block",
        wordBreak: "initial",
        whiteSpace: "pre-line",
    },
    cellEditorContainer: {
        height: "min-content !important",
        width: "100%",
        alignSelf: "flex-start",
    },
    textArea: {
        border: "none",
        outline: "none",
        boxShadow: "none !important",
        background: "transparent",
        fontSize: 14,
    },
    gridContainer: {
        height: "calc(100vh - 180px)",
    },
})

const CellRenderer = (props: any) => {
    const classes = useStyles()
    const cellValue = props.valueFormatted ? props.valueFormatted : props.value

    return <span className={classes.cellContainer}>{cellValue || ""}</span>
}

const CellEditor = (props: any, ref: React.ForwardedRef<unknown>) => {
    const [value, setValue] = useState(props.value)
    const classes = useStyles()

    const onHeightChanged = useCallback(({height}: ResizeObserverEntry["contentRect"]) => {
        if (height >= props.node.rowHeight) props.node.setRowHeight(height)
    }, [])
    const elemRef = useResizeObserver(onHeightChanged)

    // to expose AG Grid cell editor API
    useImperativeHandle(ref, () => {
        return {
            // the final value to send to the grid, on completion of editing
            getValue() {
                return value
            },
        }
    })

    return (
        <div ref={elemRef} className={classes.cellEditorContainer}>
            <Input.TextArea
                className={classes.textArea}
                autoSize={{minRows: 1}}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
            />
        </div>
    )
}

type Props = React.ComponentProps<typeof Modal> & {
    data?: Record<string, any>
    onCellValueChanged: (params: any) => void
}

const EditRowModal: React.FC<Props> = ({data, onCellValueChanged, ...props}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()

    const columnDefs = useMemo(() => {
        return Object.keys(data || {}).map((key) => ({
            field: key,
            editable: true,
            flex: 1,
            headerName: capitalize(key),
            wrapText: true,
            autoHeight: true,
            resizable: true,
            minWidth: 220,
            cellRenderer: CellRenderer,
            cellEditor: forwardRef(CellEditor),
            suppressKeyboardEvent: (params: any) => params.event.key === "Enter",
        }))
    }, [data])

    return (
        <Modal
            title="Edit Row"
            width="90vw"
            centered
            okButtonProps={{style: {display: "none"}}}
            cancelText="Close"
            {...props}
            open={!!data}
        >
            <div
                className={`${appTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine"} ${
                    classes.gridContainer
                }`}
            >
                <AgGridReact
                    columnDefs={columnDefs}
                    rowData={data ? [data] : []}
                    singleClickEdit
                    stopEditingWhenCellsLoseFocus
                    onCellValueChanged={onCellValueChanged}
                />
            </div>
        </Modal>
    )
}

export default EditRowModal
