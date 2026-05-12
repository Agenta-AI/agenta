import {useMemo} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {Input} from "antd"

import type {RegistryRevisionRow} from "@/oss/components/VariantsComponents/store/registryStore"
import {registryPaginatedStore} from "@/oss/components/VariantsComponents/store/registryStore"
import {createRegistryColumns} from "@/oss/components/VariantsComponents/Table/assets/registryColumns"

const EMPTY_ACTIONS = {}

interface SelectDeployVariantModalContentProps {
    setSelectedRowKeys: (keys: (string | number)[]) => void
    selectedRowKeys: (string | number)[]
    searchTerm: string
    onSearchChange: (value: string) => void
}

const SelectDeployVariantModalContent = ({
    setSelectedRowKeys,
    selectedRowKeys,
    searchTerm,
    onSearchChange,
}: SelectDeployVariantModalContentProps) => {
    const table = useTableManager<RegistryRevisionRow>({
        datasetStore: registryPaginatedStore.store as never,
        scopeId: "deploy-variant-selector",
        pageSize: 50,
        searchDeps: [searchTerm],
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(() => createRegistryColumns(EMPTY_ACTIONS), [])

    // Override row selection to radio mode with external state
    const rowSelection = useMemo(
        () => ({
            type: "radio" as const,
            selectedRowKeys: selectedRowKeys as React.Key[],
            onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as (string | number)[]),
        }),
        [selectedRowKeys, setSelectedRowKeys],
    )

    return (
        <div className="flex flex-col gap-4 flex-1 mt-4 h-[500px]">
            <Input.Search
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search"
                allowClear
                className="w-[400px]"
            />

            <InfiniteVirtualTableFeatureShell<RegistryRevisionRow>
                {...table.shellProps}
                columns={columns}
                rowSelection={rowSelection}
                autoHeight
            />
        </div>
    )
}

export default SelectDeployVariantModalContent
