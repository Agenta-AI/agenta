import {memo, useCallback, useMemo, useState} from "react"

import {
    variantsListAtomFamily,
    variantsListQueryStateAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {Input} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {EnhancedVariant} from "@/oss/lib/shared/variant/types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

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
    className,
    setSelectedVariantRevisionIds,
    handlePanelChange,
    evaluationType,
    variants: propsVariants,
    isVariantLoading: propsVariantLoading,
}: SelectVariantSectionProps) => {
    const appId = useAtomValue(selectedAppIdAtom) || ""
    const fallbackVariants = useAtomValue(
        useMemo(() => variantsListAtomFamily(appId), [appId]),
    ) as unknown as EnhancedVariant[]
    const fallbackLoading = useAtomValue(
        useMemo(() => variantsListQueryStateAtomFamily(appId), [appId]),
    ).isPending
    const variants = useMemo(
        () => propsVariants || fallbackVariants,
        [propsVariants, fallbackVariants],
    )
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
            if (evaluationType === "auto") {
                setSelectedVariantRevisionIds(selectedRowKeys as string[])
                return
            }
            const selectedId = selectedRowKeys[0] as string | undefined
            if (selectedId) {
                setSelectedVariantRevisionIds([selectedId])
                handlePanelChange("testsetPanel")
            } else {
                setSelectedVariantRevisionIds([])
            }
        },
        [evaluationType, handlePanelChange, setSelectedVariantRevisionIds],
    )

    const onRowClick = useCallback(
        (record: EnhancedVariant) => {
            const _record = record as EnhancedVariant & {
                children: EnhancedVariant[]
            }
            if (evaluationType === "auto") {
                const nextSelected = selectedVariantRevisionIds.includes(_record.id)
                    ? selectedVariantRevisionIds.filter((id) => id !== _record.id)
                    : [...selectedVariantRevisionIds, _record.id]
                setSelectedVariantRevisionIds(nextSelected)
                return
            }
            onSelectVariant([_record.id])
        },
        [
            evaluationType,
            onSelectVariant,
            selectedVariantRevisionIds,
            setSelectedVariantRevisionIds,
        ],
    )

    const variantsNonNull = (filteredVariant || []) as EnhancedVariant[]

    return (
        <div className={clsx(className)}>
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
                    type: evaluationType === "auto" ? "checkbox" : "radio",
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
