import {useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "100%",
    },
    label: {
        fontWeight: theme.fontWeightMedium,
        fontSize: theme.fontSize,
    },
    tableWrapper: {
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
        maxHeight: 200,
        overflowY: "auto",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: theme.fontSizeSM,
        tableLayout: "fixed",
    },
    headerRow: {
        backgroundColor: theme.colorFillQuaternary,
        position: "sticky",
        top: 0,
        zIndex: 1,
    },
    headerCell: {
        padding: "8px 12px",
        textAlign: "left",
        fontWeight: theme.fontWeightMedium,
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: 120,
        maxWidth: 200,
    },
    bodyRow: {
        "&:hover": {
            backgroundColor: theme.colorFillQuaternary,
        },
        "&:not(:last-child)": {
            borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        },
    },
    bodyCell: {
        padding: "8px 12px",
        verticalAlign: "top",
        minWidth: 120,
        maxWidth: 200,
    },
    cellContent: {
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        textOverflow: "ellipsis",
        wordBreak: "break-word",
        lineHeight: 1.5,
        color: theme.colorText,
    },
    emptyCell: {
        color: theme.colorTextQuaternary,
        fontStyle: "italic",
    },
}))

interface FilePreviewTableProps {
    data: Record<string, unknown>[]
    maxRows?: number
    className?: string
}

export function FilePreviewTable({data, maxRows = 5, className}: FilePreviewTableProps) {
    const classes = useStyles()

    const columns = useMemo(() => {
        if (data.length === 0) return []
        return Object.keys(data[0])
    }, [data])

    const displayData = useMemo(() => {
        return data.slice(0, maxRows)
    }, [data, maxRows])

    if (data.length === 0 || columns.length === 0) {
        return null
    }

    return (
        <div className={clsx(classes.container, className)}>
            <Typography.Text className={classes.label}>
                Preview ({Math.min(data.length, maxRows)} of {data.length} rows)
            </Typography.Text>
            <div className={classes.tableWrapper}>
                <table className={classes.table}>
                    <thead>
                        <tr className={classes.headerRow}>
                            {columns.map((col) => (
                                <th key={col} className={classes.headerCell} title={col}>
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {displayData.map((row, rowIdx) => (
                            <tr key={rowIdx} className={classes.bodyRow}>
                                {columns.map((col) => {
                                    const value = row[col]
                                    const displayValue =
                                        value === null || value === undefined
                                            ? ""
                                            : typeof value === "object"
                                              ? JSON.stringify(value)
                                              : String(value)
                                    const isEmpty = displayValue === ""

                                    return (
                                        <td key={col} className={classes.bodyCell}>
                                            <div
                                                className={clsx(
                                                    classes.cellContent,
                                                    isEmpty && classes.emptyCell,
                                                )}
                                                title={displayValue}
                                            >
                                                {isEmpty ? "(empty)" : displayValue}
                                            </div>
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default FilePreviewTable
