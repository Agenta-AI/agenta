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
    handlePanelChange: (key: string | string[]) => void
    activePanel: string | null
} & React.ComponentProps<typeof Collapse>

const SelectVariantSection = ({
    variants,
    usernames,
    selectedVariantIds,
    setSelectedVariantIds,
    activePanel,
    handlePanelChange,
    ...props
}: SelectVariantSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")

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
        {
            title: "Model",
            dataIndex: "parameters",
            key: "model",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                const parameters =
                    (
                        (record.parameters?.ag_config as unknown as Record<string, unknown>)
                            ?.prompt as Record<string, unknown>
                    )?.llm_config || record.parameters
                return parameters && Object.keys(parameters).length
                    ? Object.values(
                          filterVariantParameters({record: parameters, key: "model"}),
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

    const selectedVariants = useMemo(
        () => variants.filter((variant) => selectedVariantIds.includes(variant.variantId)),
        [variants, selectedVariantIds],
    )

    const handleRemoveVariant = (variantId: string) => {
        const filterVariant = selectedVariantIds.filter((id) => variantId !== id)
        setSelectedVariantIds(filterVariant)
    }

    const variantItems = useMemo(
        () => [
            {
                key: "variantPanel",
                label: (
                    <Space data-cy="evaluation-variant-collapse-header">
                        <div>Select Variant</div>
                        <Space size={0}>
                            {selectedVariants.length
                                ? selectedVariants.map((variant) => (
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
                            type: "checkbox",
                            columnWidth: 48,
                            selectedRowKeys: selectedVariantIds,
                            onChange: (selectedRowKeys) => {
                                const currentSelected = new Set(selectedVariantIds)

                                filteredVariant.forEach((item) => {
                                    if (selectedRowKeys.includes(item.variantId)) {
                                        currentSelected.add(item.variantId)
                                    } else {
                                        currentSelected.delete(item.variantId)
                                    }
                                })

                                setSelectedVariantIds(Array.from(currentSelected))
                            },
                        }}
                        className="ph-no-capture"
                        rowKey={"variantId"}
                        data-cy="evaluation-variant-table"
                        columns={columns}
                        dataSource={filteredVariant}
                        scroll={{x: true}}
                        bordered
                        pagination={false}
                    />
                ),
            },
        ],
        [filteredVariant, selectedVariantIds, handleRemoveVariant, selectedVariants],
    )

    return (
        <Collapse
            activeKey={activePanel === "variantPanel" ? "variantPanel" : undefined}
            onChange={() => handlePanelChange("variantPanel")}
            items={variantItems}
            {...props}
        />
    )
}

export default SelectVariantSection
