import {memo, useCallback, useMemo} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useGroupedTreeData,
} from "@agenta/ui/table"
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

const getVariantGroupKey = (row: RegistryRevisionRow) => row.variantId
const getVariantSelectableId = (row: RegistryRevisionRow) => row.revisionId

const SelectVariantSection = ({
    selectedVariantRevisionIds,
    className,
    setSelectedVariantRevisionIds,
    handlePanelChange,
    evaluationType,
}: SelectVariantSectionProps) => {
    const table = useTableManager<RegistryRevisionRow>({
        datasetStore: registryPaginatedStore.store as never,
        scopeId: "evaluation-variant-selector",
        pageSize: 50,
        rowClassName: "variant-table-row",
        search: {className: "w-[300px]"},
    })

    const paginationRows = table.shellProps.pagination?.rows ?? []

    const {groupedDataSource, treeExpandable, resolveSelectableId, toDisplayKeys, expandState} =
        useGroupedTreeData({
            rows: paginationRows,
            getGroupKey: getVariantGroupKey,
            getSelectableId: getVariantSelectableId,
            groupKeyPrefix: "variant-group-",
        })

    const columns = useMemo(() => createRegistryColumns(EMPTY_ACTIONS, expandState), [expandState])

    const onSelectVariant = useCallback(
        (selectedRowKeys: React.Key[]) => {
            const revisionIds = (selectedRowKeys as string[]).map(resolveSelectableId)

            if (evaluationType === "auto") {
                setSelectedVariantRevisionIds(revisionIds)
                return
            }
            const selectedId = revisionIds[0]
            if (selectedId) {
                setSelectedVariantRevisionIds([selectedId])
                handlePanelChange("testsetPanel")
            } else {
                setSelectedVariantRevisionIds([])
            }
        },
        [evaluationType, handlePanelChange, setSelectedVariantRevisionIds, resolveSelectableId],
    )

    const displaySelectedKeys = useMemo(
        () => toDisplayKeys(selectedVariantRevisionIds),
        [selectedVariantRevisionIds, toDisplayKeys],
    )

    const rowSelection = useMemo(
        () => ({
            type: (evaluationType === "auto" ? "checkbox" : "radio") as "checkbox" | "radio",
            selectedRowKeys: displaySelectedKeys,
            onChange: (keys: React.Key[]) => onSelectVariant(keys),
            selectOnRowClick: true,
        }),
        [displaySelectedKeys, onSelectVariant, evaluationType],
    )

    return (
        <div className={clsx(className)}>
            <div className="h-[455px]">
                <InfiniteVirtualTableFeatureShell<RegistryRevisionRow>
                    {...table.shellProps}
                    columns={columns}
                    rowSelection={rowSelection}
                    enableExport={false}
                    autoHeight
                    dataSource={groupedDataSource}
                    tableProps={{
                        ...table.shellProps.tableProps,
                        expandable: treeExpandable,
                    }}
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
