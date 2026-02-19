import {useMemo} from "react"

import {Table, Tag, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"

import type {ActionItem} from "@/oss/services/tools/api/types"

interface Props {
    actions: ActionItem[]
}

export default function ActionsList({actions}: Props) {
    const columns: ColumnsType<ActionItem> = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                render: (name: string) => <Typography.Text>{name}</Typography.Text>,
            },
            {
                title: "Description",
                dataIndex: "description",
                key: "description",
                ellipsis: true,
                render: (desc: string) => (
                    <Typography.Text type="secondary">{desc || "-"}</Typography.Text>
                ),
            },
            {
                title: "Tags",
                dataIndex: "tags",
                key: "tags",
                render: (tags: Record<string, unknown> | undefined) =>
                    tags ? Object.keys(tags).map((t) => <Tag key={t}>{t}</Tag>) : <span>-</span>,
            },
        ],
        [],
    )

    return (
        <Table<ActionItem>
            dataSource={actions}
            columns={columns}
            rowKey="key"
            pagination={actions.length > 20 ? {pageSize: 20} : false}
            size="small"
            bordered
        />
    )
}
