// @ts-nocheck
import {useMemo} from "react"

import {type ICellRendererParams} from "@ag-grid-community/core"
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
        <span className={classes.cellContainer}>
            <span className={classes.cellValue}>{cellValue || ""}</span>
        </span>
    ) : undefined
}

export default TableCellsRenderer
