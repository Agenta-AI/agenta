import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {testset} from "@/lib/Types"
import {CloseCircleOutlined} from "@ant-design/icons"
import {Collapse, Input, Space, Tag} from "antd"
import Table, {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import React, {useMemo, useState} from "react"

type SelectTestsetSectionProps = {
    testSets: testset[]
    selectedTestsetId: string
    setSelectedTestsetId: React.Dispatch<React.SetStateAction<string>>
} & React.ComponentProps<typeof Collapse>

const SelectTestsetSection = ({
    testSets,
    selectedTestsetId,
    setSelectedTestsetId,
    ...props
}: SelectTestsetSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")

    const columns: ColumnsType<testset> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            onHeaderCell: () => ({
                style: {minWidth: 220},
            }),
        },
        {
            title: "Date Modified",
            dataIndex: "updated_at",
            key: "updated_at",
            onHeaderCell: () => ({
                style: {minWidth: 220},
            }),
            render: (date: string) => {
                return formatDate(date)
            },
        },
        {
            title: "Date created",
            dataIndex: "created_at",
            key: "created_at",
            render: (date: string) => {
                return formatDate(date)
            },
            onHeaderCell: () => ({
                style: {minWidth: 220},
            }),
        },
    ]

    const filteredTestset = useMemo(() => {
        let allTestsets = testSets.sort(
            (a: testset, b: testset) =>
                dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf(),
        )
        if (searchTerm) {
            allTestsets = testSets.filter((item: testset) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
        return allTestsets
    }, [searchTerm, testSets])

    const handleRemoveTestset = () => {
        setSelectedTestsetId("")
    }

    const selectedTestset = useMemo(
        () => testSets.find((testset) => testset._id === selectedTestsetId) || null,
        [selectedTestsetId, testSets],
    )

    return (
        <Collapse
            defaultActiveKey={["1"]}
            {...props}
            items={[
                {
                    key: "1",
                    label: (
                        <Space>
                            <div>Select Testset</div>
                            {selectedTestset && (
                                <Tag
                                    closeIcon={<CloseCircleOutlined />}
                                    onClose={handleRemoveTestset}
                                >
                                    {selectedTestset.name}
                                </Tag>
                            )}
                            {}
                        </Space>
                    ),
                    extra: (
                        <Input.Search
                            placeholder="Search"
                            className="w-[300px] mx-6"
                            onClick={(event) => {
                                event.stopPropagation()
                            }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    ),
                    children: (
                        <Table
                            rowSelection={{
                                type: "radio",
                                columnWidth: 48,
                                selectedRowKeys: [selectedTestset?._id as React.Key],
                                onChange: (selectedRowKeys) => {
                                    setSelectedTestsetId(selectedRowKeys[0] as string)
                                },
                            }}
                            data-cy="app-testset-list"
                            className={`ph-no-capture`}
                            columns={columns}
                            dataSource={filteredTestset}
                            rowKey="_id"
                            scroll={{x: true}}
                            pagination={false}
                        />
                    ),
                },
            ]}
        />
    )
}

export default SelectTestsetSection
