import {useMemo} from "react"

import {Table} from "antd"
import {ColumnsType} from "antd/es/table"
import clsx from "clsx"

const ConfigurationTable = () => {
    const columns: ColumnsType<any> = useMemo(
        () => [
            {
                title: "Revision",
                dataIndex: "revision",
                key: "revision",
                width: 48,
                render: (_, record, index) => {
                    return <span>{record.revision}</span>
                },
            },
            {
                title: "Date Modified",
                dataIndex: "date_modified",
                key: "date_modified",
                render: (_, record) => <span>{record.date_modified}</span>,
            },
            {
                title: "Modified By",
                dataIndex: "modified_by",
                key: "modified_by",
                render: (_, record) => <span>{record.modified_by}</span>,
            },
        ],
        [],
    )

    return (
        <Table
            bordered={true}
            className={clsx("flex-1", "[&_.ant-table-row]:h-12")}
            columns={columns}
            rowKey={"id"}
            dataSource={[
                {
                    revision: "v3",
                    date_modified: "16 Jun 2024",
                    modified_by: "<username>",
                },
                {
                    revision: "v2",
                    date_modified: "16 Jun 2024",
                    modified_by: "<username>",
                },
                {
                    revision: "v1",
                    date_modified: "16 Jun 2024",
                    modified_by: "<username>",
                },
            ]}
            scroll={{x: true}}
            onRow={(record, index) => ({
                onClick: () => {},
                style: {cursor: "pointer"},
            })}
            pagination={false}
        />
    )
}

export default ConfigurationTable
