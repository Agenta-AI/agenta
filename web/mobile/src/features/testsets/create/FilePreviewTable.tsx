/** One cell as text. Objects and arrays show as JSON. */
const cellText = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    return typeof value === "object" ? JSON.stringify(value) : String(value)
}

/** The first rows of a file, columns from every row shown. */
export const FilePreviewTable = ({rows}: {rows: Record<string, unknown>[]}) => {
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    if (columns.length === 0) return null

    return (
        <div className="max-w-full overflow-x-auto rounded-md border border-solid border-border">
            <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-muted text-muted-foreground">
                    <tr>
                        {columns.map((column) => (
                            <th
                                key={column}
                                scope="col"
                                className="max-w-[180px] truncate px-2 py-1.5 font-medium"
                            >
                                {column}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index} className="border-0 border-t border-solid border-border">
                            {columns.map((column) => (
                                <td
                                    key={column}
                                    className="max-w-[180px] truncate px-2 py-1.5 text-foreground"
                                >
                                    {cellText(row[column])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
