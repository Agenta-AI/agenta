import {memo, useCallback, useMemo, useState} from "react"

import {Input} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import type {SelectVariantSectionProps} from "../types"

const VariantsTable = dynamic(() => import("@/oss/components/VariantsComponents/Table"), {
    ssr: false,
})
const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const SelectVariantSection = ({
    selectedVariantRevisionIds,
    className,
    setSelectedVariantRevisionIds,
    handlePanelChange,
    evaluationType,
    variants: propsVariants,
    ...props
}: SelectVariantSectionProps) => {
    const {currentApp} = useAppsData()
    const appId = useAppId()
    const {data, isLoading: isVariantLoading} = useVariants(currentApp)({appId})
    const variants = useMemo(() => propsVariants || data?.variants, [propsVariants, data?.variants])

    const [searchTerm, setSearchTerm] = useState("")

    const filteredVariant = useMemo(() => {
        if (!searchTerm) return variants
        return variants?.filter((item) =>
            item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, variants])

    const onSelectVariant = useCallback(
        (selectedRowKeys: React.Key[]) => {
            const selectedId = selectedRowKeys[0] as string | undefined
            if (selectedId) {
                setSelectedVariantRevisionIds([selectedId])
                handlePanelChange("evaluatorPanel")
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

    return (
        <div className={clsx(className)} {...props}>
            <div className="flex items-center justify-between mb-2">
                <Input.Search
                    placeholder="Search"
                    className="w-[300px] [&_input]:!py-[3.1px]"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <VariantsTable
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
                        onClick: () => onRowClick(record as EnhancedVariant),
                    }
                }}
                showActionsDropdown={false}
                scroll={{x: "max-content", y: 455}}
                isLoading={isVariantLoading}
                variants={filteredVariant}
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
