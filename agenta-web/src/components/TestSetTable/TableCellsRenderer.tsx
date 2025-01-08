import {Tooltip} from "antd"
import {createUseStyles} from "react-jss"
import {EditOutlined} from "@ant-design/icons"
import {type ICellRendererParams} from "@ag-grid-community/core"

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

const TableCellsRenderer = (props: ICellRendererParams) => {
    const classes = useStylesCell()
    const cellValue = props.valueFormatted ? props.valueFormatted : props.value

    return props.colDef?.field ? (
        <span
            className={classes.cellContainer}
            onClick={() =>
                props.api.startEditingCell({
                    rowIndex: props.node.rowIndex as number,
                    colKey: props.colDef?.field as string,
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

export default TableCellsRenderer
