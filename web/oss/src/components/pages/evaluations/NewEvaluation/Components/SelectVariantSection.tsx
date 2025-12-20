import {memo, useCallback, useMemo, useState} from "react"

import {Button, Input} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useVariants} from "@/oss/lib/hooks/useVariants"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {currentAppAtom} from "@/oss/state/app"

import type {SelectVariantSectionProps} from "../types"

const VariantsTable = dynamic(() => import("@/oss/components/VariantsComponents/Table"), {
    ssr: false,
})
const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const SelectVariantSection = ({
    selectedVariantRevisionIds,
    selectedTestsetId,
    className,
    setSelectedVariantRevisionIds,
    handlePanelChange,
    evaluationType,
    variants: propsVariants,
    isVariantLoading: propsVariantLoading,
    ...props
}: SelectVariantSectionProps) => {
    const currentApp = useAtomValue(currentAppAtom)

    const {data, isLoading: fallbackLoading} = useVariants(currentApp)
    const variants = useMemo(() => propsVariants || data, [propsVariants, data])
    const isVariantLoading = propsVariantLoading ?? fallbackLoading

    const [searchTerm, setSearchTerm] = useState("")

    const filteredVariant = useMemo(() => {
        if (!searchTerm) return variants
        return variants?.filter((item: EnhancedVariant) =>
            item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, variants])

    const onSelectVariant = useCallback(
        (selectedRowKeys: React.Key[]) => {
            // Support multiple variant selection - keep all selected variants
            setSelectedVariantRevisionIds(selectedRowKeys as string[])
        },
        [setSelectedVariantRevisionIds],
    )

    const handleContinue = useCallback(() => {
        if (selectedVariantRevisionIds.length > 0) {
            handlePanelChange("testsetPanel")
        }
    }, [selectedVariantRevisionIds, handlePanelChange])

    const onRowClick = useCallback(
        (record: EnhancedVariant) => {
            const _record = record as EnhancedVariant & {
                children: EnhancedVariant[]
            }
            // Toggle selection: add if not selected, remove if already selected
            const isSelected = selectedVariantRevisionIds.includes(_record.id)
            if (isSelected) {
                setSelectedVariantRevisionIds(
                    selectedVariantRevisionIds.filter((id) => id !== _record.id),
                )
            } else {
                setSelectedVariantRevisionIds([...selectedVariantRevisionIds, _record.id])
            }
        },
        [selectedVariantRevisionIds, setSelectedVariantRevisionIds],
    )

    const variantsNonNull = (filteredVariant || []) as EnhancedVariant[]

    return (
        <div className={clsx(className)} {...props}>
            <div className="flex items-start justify-between mb-2 gap-4">
                <Input.Search
                    placeholder="Search"
                    className="w-[300px] [&_input]:!py-[3.1px]"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Button
                    type="primary"
                    disabled={selectedVariantRevisionIds.length === 0}
                    onClick={handleContinue}
                >
                    Continue{" "}
                    {selectedVariantRevisionIds.length > 0 &&
                        `(${selectedVariantRevisionIds.length} selected)`}
                </Button>
            </div>
            <VariantsTable
                showStableName
                rowSelection={{
                    type: "checkbox",
                    selectedRowKeys: selectedVariantRevisionIds,
                    onChange: (selectedRowKeys) => {
                        onSelectVariant(selectedRowKeys)
                    },
                }}
                onRow={(record) => {
                    return {
                        style: {cursor: "pointer"},
                        onClick: () => {
                            onRowClick(record as EnhancedVariant)
                        },
                    }
                }}
                showActionsDropdown={false}
                scroll={{x: "max-content", y: 455}}
                isLoading={isVariantLoading}
                variants={variantsNonNull}
                onRowClick={() => {}}
                className="ph-no-capture"
                rowKey={"id"}
                locale={{
                    emptyText: (
                        <NoResultsFound
                            className="!py-10"
                            description="No available variants found to display"
                        />
                    ),
                }}
            />
        </div>
    )
}

export default memo(SelectVariantSection)
