// @ts-nocheck
import {useMemo} from "react"

import {type ICellRendererParams} from "@ag-grid-community/core"
import {EditOutlined} from "@ant-design/icons"
import {Tooltip} from "antd"
import {createUseStyles} from "react-jss"

import {getStringOrJson} from "@/oss/lib/helpers/utils"

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

    const regularDisplay = props.valueFormatted ? props.valueFormatted : props.value

    const cellValue = useMemo(() => {
        const key = props.colDef?.field
        if (
            typeof props.data?.[key] === "object" &&
            props.data?.[key] !== null &&
            Object.keys(props.data[key]).length > 0
        ) {
            try {
                return getStringOrJson(props.data[key])
            } catch (error) {
                console.error("Table cell renderer error", error)
                return regularDisplay
            }
        }
        return regularDisplay
    }, [])

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
