const cellText = (value: unknown) =>
    typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)

/** Step 3: the first rows the save will add, built by the same function as the save. */
export const MappingPreview = ({
    spanCount,
    columns,
    rows,
}: {
    spanCount: number
    columns: readonly string[]
    rows: readonly Record<string, unknown>[]
}) => (
    <section className="flex flex-col gap-2">
        <div>
            <h3 className="m-0 text-sm font-medium">
                {spanCount > 1 ? "3. Preview test cases" : "3. Preview test case"}
            </h3>
            <p className="text-muted-foreground m-0 text-xs">
                See how your mapped data will appear in the test set
            </p>
        </div>
        {columns.length === 0 ? (
            <p className="text-muted-foreground m-0 text-sm">
                Add at least one mapping to see how your data will appear
            </p>
        ) : (
            <div className="border-border overflow-x-auto rounded-md border border-solid">
                <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-muted/50">
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column}
                                    scope="col"
                                    className="border-border border-0 border-b border-solid px-3 py-2 font-medium"
                                >
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr
                                key={index}
                                className="border-border border-0 border-b border-solid last:border-b-0"
                            >
                                {columns.map((column) => (
                                    <td
                                        key={column}
                                        className="max-w-48 truncate px-3 py-2 align-top font-mono"
                                        title={cellText(row[column])}
                                    >
                                        {cellText(row[column])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </section>
)
