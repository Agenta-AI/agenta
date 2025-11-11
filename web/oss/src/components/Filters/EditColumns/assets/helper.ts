import {ColumnsType} from "antd/es/table"

export const filterColumns = <T>(cols: ColumnsType<T>, hidden: string[]): ColumnsType<T> => {
    return cols
        .map((col) => {
            const key = col.key != null ? String(col.key) : undefined
            if (key && hidden.includes(key)) return null

            if ("children" in col && col.children) {
                const children = filterColumns(col.children, hidden)

                if (!children.length) {
                    // Drop parent column when all descendants are hidden to avoid rendering entire records
                    // as fallback cell content in Ant Table.
                    return null
                }

                return {
                    ...col,
                    children,
                }
            }

            return col
        })
        .filter(Boolean) as ColumnsType<T>
}

export const formatColumnTitle = (text: string) => {
    return text
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())
}
