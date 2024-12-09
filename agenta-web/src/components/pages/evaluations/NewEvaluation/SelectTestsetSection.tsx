import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {JSSTheme, testset} from "@/lib/Types"
import {CloseCircleOutlined} from "@ant-design/icons"
import {Collapse, Input, Space, Tag} from "antd"
import Table, {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

type SelectTestsetSectionProps = {
    testSets: testset[]
    selectedTestsetId: string
    setSelectedTestsetId: React.Dispatch<React.SetStateAction<string>>
    handlePanelChange: (key: string | string[]) => void
    activePanel: string | null
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: {
        "& .ant-collapse-header": {
            alignItems: "center !important",
        },
        "& .ant-collapse-content": {
            maxHeight: 400,
            height: "100%",
            overflowY: "auto",
            "& .ant-collapse-content-box": {
                padding: 0,
            },
        },
        "& .ant-input-group-addon button": {
            height: 30,
        },
    },
}))

const SelectTestsetSection = ({
    testSets,
    selectedTestsetId,
    setSelectedTestsetId,
    activePanel,
    handlePanelChange,
}: SelectTestsetSectionProps) => {
    const classes = useStyles()
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
            className={classes.collapseContainer}
            activeKey={activePanel === "testsetPanel" ? "testsetPanel" : undefined}
            onChange={() => handlePanelChange("testsetPanel")}
            items={[
                {
                    key: "testsetPanel",
                    label: (
                        <Space data-cy="evaluation-testset-collapse-header">
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
                            className="w-[300px]"
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
                                    handlePanelChange("variantPanel")
                                },
                            }}
                            data-cy="evaluation-testset-table"
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
