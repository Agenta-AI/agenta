import {useMemo, useState} from "react"

import {CloseCircleOutlined} from "@ant-design/icons"
import {Collapse, Input, Space, Tag} from "antd"

import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import VariantsTable from "@/oss/components/VariantsComponents/Table"

type SelectVariantSectionProps = {
    isVariantLoading: boolean
    variants: EnhancedVariant[]
    selectedVariantIds: string[]
    setSelectedVariantIds: React.Dispatch<React.SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    activePanel: string | null
} & React.ComponentProps<typeof Collapse>

const SelectVariantSection = ({
    variants,
    selectedVariantIds,
    setSelectedVariantIds,
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
                        <Space>
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
                    <VariantsTable
                        rowSelection={{
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
                        showActionsDropdown={false}
                        isLoading={false}
                        variants={filteredVariant}
                        onRowClick={() => {}}
                        className="ph-no-capture"
                        rowKey={"variantId"}
                        data-cy="evaluation-variant-table"
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
