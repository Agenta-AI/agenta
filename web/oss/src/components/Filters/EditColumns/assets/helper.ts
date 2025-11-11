import { ColumnsType } from "antd/es/table"

export const filterColumns = <T>(cols: ColumnsType<T>, hidden: string[]): ColumnsType<T> => {
    return cols
        .filter((col) => !hidden.includes(String(col.key)))
        .map((col) => {
            if ("children" in col && col.children) {
                const children = filterColumns(col.children, hidden)
                return children.length > 0 ? {...col, children} : {...col, children: undefined}
            }
            return col
        }) as ColumnsType<T>
}

export const formatColumnTitle = (text: string) => {
    return text
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())
}