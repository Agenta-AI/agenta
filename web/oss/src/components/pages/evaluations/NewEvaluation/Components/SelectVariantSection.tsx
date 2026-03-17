import {memo, useCallback, useMemo, useState} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {Input} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import type {RegistryRevisionRow} from "@/oss/components/VariantsComponents/store/registryStore"
import {registryPaginatedStore} from "@/oss/components/VariantsComponents/store/registryStore"
import {createRegistryColumns} from "@/oss/components/VariantsComponents/Table/assets/registryColumns"

import type {SelectVariantSectionProps} from "../types"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {
        ssr: false,
    },
)

const EMPTY_ACTIONS = {}

const SelectVariantSection = ({
    selectedVariantRevisionIds,
    className,
    setSelectedVariantRevisionIds,
    handlePanelChange,
    evaluationType,
}: SelectVariantSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")

    const table = useTableManager<RegistryRevisionRow>({
        datasetStore: registryPaginatedStore.store as never,
        scopeId: "evaluation-variant-selector",
        pageSize: 50,
        searchDeps: [searchTerm],
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(() => createRegistryColumns(EMPTY_ACTIONS), [])

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

    const rowSelection = useMemo(
        () => ({
            type: (evaluationType === "auto" ? "checkbox" : "radio") as "checkbox" | "radio",
            selectedRowKeys: selectedVariantRevisionIds as React.Key[],
            onChange: (keys: React.Key[]) => onSelectVariant(keys),
        }),
        [selectedVariantRevisionIds, onSelectVariant, evaluationType],
    )

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
            <div className="h-[455px]">
                <InfiniteVirtualTableFeatureShell<RegistryRevisionRow>
                    {...table.shellProps}
                    columns={columns}
                    rowSelection={rowSelection}
                    autoHeight
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
        </div>
    )
}

export default memo(SelectVariantSection)
