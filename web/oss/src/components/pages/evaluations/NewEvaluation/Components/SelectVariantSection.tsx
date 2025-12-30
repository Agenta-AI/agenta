import {memo, useCallback, useMemo, useState} from "react"

import {Input} from "antd"
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
const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {
        ssr: false,
    },
)

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
            const selectedId = selectedRowKeys[0] as string | undefined
            if (selectedId) {
                setSelectedVariantRevisionIds([selectedId])
                handlePanelChange("testsetPanel")
            } else {
                setSelectedVariantRevisionIds([])
            }
        },
        [setSelectedVariantRevisionIds, handlePanelChange],
    )

    const onRowClick = useCallback(
        (record: EnhancedVariant) => {
            const _record = record as EnhancedVariant & {
                children: EnhancedVariant[]
            }
            onSelectVariant([_record.id])
        },
        [selectedVariantRevisionIds, onSelectVariant],
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
            </div>
            <VariantsTable
                showStableName
                rowSelection={{
                    type: "radio",
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
