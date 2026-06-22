import {useCallback, useEffect, useMemo} from "react"

import {queryHeadQueryAtomFamily} from "@agenta/entities/query"
import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import type {Key} from "antd/es/table/interface"
import {useAtomValue, useSetAtom} from "jotai"

import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"
import {querySearchTermAtomFamily} from "@/oss/components/QueryRegistry/store/queryRegistryFilterAtoms"
import type {QueryRegistryRow} from "@/oss/components/QueryRegistry/store/queryRegistryStore"
import {getQueryRegistryTableState} from "@/oss/components/QueryRegistry/store/queryRegistryStore"
import {
    buildFieldLabelMap,
    createQueryRegistryColumns,
} from "@/oss/components/QueryRegistry/Table/assets/queryRegistryColumns"

import type {EvalStepSectionProps, QueryStepValue} from "../evalSteps/types"

const QUERY_SELECTOR_SCOPE = "new-evaluation-query-selector"
const querySelectionStore = getQueryRegistryTableState("active", QUERY_SELECTOR_SCOPE)
const querySelectionSearchTermAtom = querySearchTermAtomFamily(QUERY_SELECTOR_SCOPE)

const QuerySourceSection = ({value, context}: EvalStepSectionProps<QueryStepValue>) => {
    const resetSearch = useSetAtom(querySelectionSearchTermAtom)
    const table = useTableManager<QueryRegistryRow>({
        datasetStore: querySelectionStore.store as never,
        scopeId: QUERY_SELECTOR_SCOPE,
        pageSize: 50,
        clickableRows: false,
        search: {
            atom: querySelectionSearchTermAtom,
            placeholder: "Search queries",
            // max-w (not w-) so it actually constrains: the shell always applies `w-full`,
            // and `cn` here is plain concatenation, so a competing `w-[…]` loses to it.
            className: "max-w-[280px]",
        },
    })

    useEffect(() => {
        querySelectionStore.invalidate()
        return () => {
            resetSearch("")
            table.clearSelection()
        }
    }, [resetSearch, table.clearSelection])

    const rows = table.shellProps.pagination?.rows ?? []
    const selectedQueryAtom = useMemo(
        () => queryHeadQueryAtomFamily(value.queryId),
        [value.queryId],
    )
    const selectedQueryState = useAtomValue(selectedQueryAtom)
    const dataSource = useMemo(() => {
        if (!value.queryId || rows.some((row) => row.queryId === value.queryId)) return rows
        const revision = selectedQueryState.data
        const selectedRow: QueryRegistryRow = {
            key: value.queryId,
            queryId: value.queryId,
            variantId: revision?.query_variant_id ?? revision?.variant_id ?? null,
            revisionId: value.revisionId ?? revision?.id ?? null,
            name:
                value.name ??
                revision?.name ??
                revision?.query_slug ??
                revision?.artifact_slug ??
                value.queryId,
            slug: revision?.query_slug ?? revision?.artifact_slug ?? null,
            filtering: revision?.data?.filtering ?? null,
            windowing: revision?.data?.windowing ?? null,
            createdAt: revision?.created_at ?? null,
            createdById: revision?.created_by_id ?? null,
            version: revision?.version ?? null,
        }
        return [selectedRow, ...rows]
    }, [rows, selectedQueryState.data, value])

    const selectedRowKeys = useMemo<Key[]>(() => (value.queryId ? [value.queryId] : []), [value])
    useEffect(() => {
        if (!value.queryId) return
        const row = dataSource.find((candidate) => candidate.queryId === value.queryId)
        if (!row) return
        const revisionId = row.revisionId ?? value.revisionId ?? undefined
        const name = row.name || value.name
        if (revisionId === value.revisionId && name === value.name) return
        context.setStepValue("query", {queryId: value.queryId, revisionId, name})
    }, [context, dataSource, value])

    const handleSelectionChange = useCallback(
        (keys: Key[]) => {
            const queryId = keys.at(-1)
            if (!queryId) {
                context.setStepValue("query", {queryId: ""})
                return
            }
            const row = dataSource.find((candidate) => candidate.queryId === String(queryId))
            if (!row) return
            context.setStepValue("query", {
                queryId: row.queryId,
                revisionId: row.revisionId ?? undefined,
                name: row.name || undefined,
            })
        },
        [context, dataSource],
    )

    const fieldLabels = useMemo(() => buildFieldLabelMap(getFilterColumns()), [])
    const columns = useMemo(
        () =>
            createQueryRegistryColumns({}, fieldLabels).filter((column) =>
                ["name", "filter", "createdAt", "createdBy"].includes(String(column.key)),
            ),
        [fieldLabels],
    )
    const rowSelection = useMemo(
        () => ({
            ...table.shellProps.rowSelection,
            type: "radio" as const,
            selectedRowKeys,
            selectOnRowClick: true,
            onChange: (keys: Key[]) => {
                table.setSelectedRowKeys(keys)
                handleSelectionChange(keys)
            },
        }),
        [
            handleSelectionChange,
            selectedRowKeys,
            table.setSelectedRowKeys,
            table.shellProps.rowSelection,
        ],
    )

    return (
        <InfiniteVirtualTableFeatureShell<QueryRegistryRow>
            {...table.shellProps}
            columns={columns}
            dataSource={dataSource}
            rowSelection={rowSelection}
            enableExport={false}
            useSettingsDropdown={false}
            autoHeight
            className="h-full min-h-0"
        />
    )
}

export default QuerySourceSection
