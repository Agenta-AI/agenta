import {filterVariantParameters, isDemo} from "@/lib/helpers/utils"
import {Variant} from "@/lib/Types"
import {CloseCircleOutlined} from "@ant-design/icons"
import {Collapse, Input, Space, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useMemo, useState} from "react"

type SelectVariantSectionProps = {
    variants: Variant[]
    usernames: Record<string, string>
    selectedVariantIds: string[]
    setSelectedVariantIds: React.Dispatch<React.SetStateAction<string[]>>
} & React.ComponentProps<typeof Collapse>

const SelectVariantSection = ({
    variants,
    usernames,
    selectedVariantIds,
    setSelectedVariantIds,
    ...props
}: SelectVariantSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedRows, setSelectedRows] = useState<Variant[]>([])

    const columns: ColumnsType<Variant> = [
        {
            title: "Name",
            dataIndex: "variant_name",
            key: "variant_name",
            fixed: "left",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <span>{record.variantName}</span>
            },
        },
        {
            title: "Last modified",
            dataIndex: "updatedAt",
            key: "updatedAt",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <div>{record.updatedAt}</div>
            },
        },
    ]

    if (isDemo()) {
        columns.push({
            title: "Modified by",
            dataIndex: "modifiedById",
            key: "modifiedById",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <div>{usernames[record.modifiedById]}</div>
            },
        })
    }

    columns.push(
        // {
        //     title: "Tags",
        //     onHeaderCell: () => ({
        //         style: {minWidth: 160},
        //     }),
        // },
        {
            title: "Model",
            dataIndex: "parameters",
            key: "model",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return record.parameters && Object.keys(record.parameters).length
                    ? Object.values(
                          filterVariantParameters({record: record.parameters, key: "model"}),
                      ).map((value, index) => (value ? <Tag key={index}>{value}</Tag> : "-"))
                    : "-"
            },
        },
        {
            title: "Created on",
            dataIndex: "createdAt",
            key: "createdAt",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <div>{record.createdAt}</div>
            },
        },
    )

    const filteredVariant = useMemo(() => {
        if (!searchTerm) return variants
        return variants.filter((item) =>
            item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, variants])

    const handleRemoveVariant = (variantId: string) => {
        const filterVariant = selectedRows.filter((variant) => variantId !== variant.variantId)

        setSelectedVariantIds(filterVariant.map((v) => v.variantId))
        setSelectedRows(filterVariant)
    }

    return (
        <Collapse
            defaultActiveKey={["1"]}
            {...props}
            items={[
                {
                    key: "1",
                    label: (
                        <Space>
                            <div>Select Variant</div>
                            <Space size={0}>
                                {selectedRows.length
                                    ? selectedRows.map((variant) => (
                                          <Tag
                                              key={variant.variantId}
                                              closeIcon={<CloseCircleOutlined />}
                                              onClose={() => handleRemoveVariant(variant.variantId)}
                                          >
                                              {variant.variantName}
                                          </Tag>
                                      ))
                                    : null}
                            </Space>
                        </Space>
                    ),
                    extra: (
                        <Input.Search
                            placeholder="Search"
                            className="w-[300px] mx-6"
                            allowClear
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
                                type: "checkbox",
                                columnWidth: 48,
                                selectedRowKeys: selectedVariantIds,
                                onChange: (selectedRowKeys, selectedRows) => {
                                    setSelectedRows(selectedRows)
                                    setSelectedVariantIds(selectedRowKeys as string[])
                                },
                            }}
                            className="ph-no-capture"
                            rowKey={"variantId"}
                            columns={columns}
                            dataSource={filteredVariant}
                            scroll={{x: true}}
                            bordered
                            pagination={false}
                        />
                    ),
                },
            ]}
        />
    )
}

export default SelectVariantSection
