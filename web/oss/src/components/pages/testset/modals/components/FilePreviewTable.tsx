import {useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"

interface FilePreviewTableProps {
    data: Record<string, unknown>[]
    maxRows?: number
    className?: string
}

export function FilePreviewTable({data, maxRows = 5, className}: FilePreviewTableProps) {
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
        <div className={clsx("flex flex-col gap-1 w-full", className)}>
            <Typography.Text className="font-medium text-sm">
                Preview ({Math.min(data.length, maxRows)} of {data.length} rows)
            </Typography.Text>
            <div className="border border-solid border-colorBorderSecondary rounded-md overflow-hidden max-h-[200px] overflow-y-auto">
                <table className="w-full border-collapse text-xs table-fixed">
                    <thead>
                        <tr className="bg-colorFillQuaternary sticky top-0 z-[1]">
                            {columns.map((col) => (
                                <th
                                    key={col}
                                    className="py-2 px-3 text-left font-medium border-b border-solid border-colorBorderSecondary whitespace-nowrap overflow-hidden text-ellipsis min-w-[120px] max-w-[200px]"
                                    title={col}
                                >
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {displayData.map((row, rowIdx) => (
                            <tr
                                key={rowIdx}
                                className="hover:bg-colorFillQuaternary [&:not(:last-child)]:border-b [&:not(:last-child)]:border-solid [&:not(:last-child)]:border-colorBorderSecondary"
                            >
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
                                        <td
                                            key={col}
                                            className="py-2 px-3 align-top min-w-[120px] max-w-[200px]"
                                        >
                                            <div
                                                className={clsx(
                                                    "[display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden text-ellipsis break-words leading-normal text-colorText",
                                                    isEmpty && "text-colorTextQuaternary italic",
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
