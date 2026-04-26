import {useCallback, useState} from "react"

import {Input} from "antd"
import {useAtom} from "jotai"

import {FiltersPopoverTrigger} from "@/oss/components/InfiniteVirtualTable"
import {getTestsetTableState, type TestsetTableMode} from "@/oss/state/entities/testset"

import TestsetsFiltersContent from "./TestsetsFiltersContent"
import TestsetsFiltersSummary from "./TestsetsFiltersSummary"

interface TestsetsHeaderFiltersProps {
    tableMode?: TestsetTableMode
}

const TestsetsHeaderFilters = ({tableMode = "active"}: TestsetsHeaderFiltersProps) => {
    const tableState = getTestsetTableState(tableMode)
    const [searchTerm, setSearchTerm] = useAtom(tableState.searchTermAtom)
    const [dateCreatedFilter] = useAtom(tableState.dateCreatedFilterAtom)
    const [dateModifiedFilter] = useAtom(tableState.dateModifiedFilterAtom)
    const [, setIsFiltersOpen] = useState(false)
    const filterCount = [dateCreatedFilter, dateModifiedFilter].filter(Boolean).length

    const handleFiltersOpenChange = useCallback((open: boolean) => {
        setIsFiltersOpen(open)
    }, [])

    return (
        <div className="flex gap-2 flex-1 items-center min-w-[320px] shrink">
            <Input
                allowClear
                placeholder="Search"
                className="min-w-0 shrink max-w-[320px]"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                style={{minWidth: 220}}
            />
            <FiltersPopoverTrigger
                filterCount={filterCount}
                buttonType={filterCount > 0 ? "primary" : "default"}
                onOpenChange={handleFiltersOpenChange}
                popoverProps={{
                    overlayStyle: {
                        backgroundColor: "transparent",
                        boxShadow: "none",
                        padding: 0,
                    },
                    arrow: false,
                }}
                renderContent={(close) => (
                    <TestsetsFiltersContent tableMode={tableMode} onClose={close} />
                )}
            />
            <TestsetsFiltersSummary tableMode={tableMode} />
        </div>
    )
}

export default TestsetsHeaderFilters
