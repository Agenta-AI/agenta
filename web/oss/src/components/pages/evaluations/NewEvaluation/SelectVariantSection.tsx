import {useMemo, useState} from "react"

import {CloseCircleOutlined} from "@ant-design/icons"
import {Collapse, Input, Space, Tag} from "antd"

import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

type SelectVariantSectionProps = {
    isVariantLoading: boolean
    variants: EnhancedVariant[]
    selectedVariantRevisionIds: string[]
    setSelectedVariantRevisionIds: React.Dispatch<React.SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    activePanel: string | null
} & React.ComponentProps<typeof Collapse>

const SelectVariantSection = ({
    variants,
    selectedVariantRevisionIds,
    setSelectedVariantRevisionIds,
    activePanel,
    handlePanelChange,
    isVariantLoading,
    ...props
}: SelectVariantSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")

    const filteredVariant = useMemo(() => {
        if (!searchTerm) return variants
        return variants.filter((item) =>
            item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, variants])

    const selectedVariants = useMemo(
        () => variants.filter((variant) => selectedVariantRevisionIds.includes(variant.id)),
        [variants, selectedVariantRevisionIds],
    )

    const handleRemoveVariant = (revisionId: string) => {
        const filterVariant = selectedVariantRevisionIds.filter((id) => revisionId !== id)
        setSelectedVariantRevisionIds(filterVariant)
    }

    const variantItems = useMemo(
        () => [
            {
                key: "variantPanel",
                label: (
                    <Space>
                        <div>Select Variant</div>
                        <Space>
                            {selectedVariants.length
                                ? selectedVariants.map((variant) => (
                                      <Tag
                                          key={variant.id}
                                          closeIcon={<CloseCircleOutlined />}
                                          onClose={() => handleRemoveVariant(variant.id)}
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
                    <VariantsTable
                        rowSelection={{
                            selectedRowKeys: selectedVariantRevisionIds,
                            onChange: (selectedRowKeys) => {
                                const currentSelected = new Set(selectedVariantRevisionIds)
                                filteredVariant.forEach((item) => {
                                    if (selectedRowKeys.includes(item.id)) {
                                        currentSelected.add(item.id)
                                    } else {
                                        currentSelected.delete(item.id)
                                    }
                                })
                                setSelectedVariantRevisionIds(Array.from(currentSelected))
                            },
                        }}
                        showActionsDropdown={false}
                        isLoading={false}
                        variants={filteredVariant}
                        onRowClick={() => {}}
                        className="ph-no-capture"
                        rowKey={"id"}
                    />
                ),
            },
        ],
        [filteredVariant, selectedVariantRevisionIds, handleRemoveVariant, selectedVariants],
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
