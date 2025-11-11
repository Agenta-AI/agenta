import { ColumnType } from "antd/es/table";

export const FIXED_COLUMNS: ColumnType<any>[] = [
    {
        title: "Metric",
        dataIndex: "title",
        key: "title",
        minWidth: 120,
        fixed: "left",
    },
    {
        title: "Label",
        dataIndex: "label",
        key: "label",
        minWidth: 120,
    },
]
    