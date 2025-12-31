import {useCallback, useState} from "react"

import {Input} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {FiltersPopoverTrigger} from "@/oss/components/InfiniteVirtualTable"
import {testset} from "@/oss/state/entities/testset"

import {testsetsFiltersButtonStateAtom} from "../atoms/filters"

import TestsetsFiltersContent from "./TestsetsFiltersContent"
import TestsetsFiltersSummary from "./TestsetsFiltersSummary"

const TestsetsHeaderFilters = () => {
    const [searchTerm, setSearchTerm] = useAtom(testset.filters.searchTerm)
    const filtersButtonState = useAtomValue(testsetsFiltersButtonStateAtom)
    const [isFiltersOpen, setIsFiltersOpen] = useState(false)

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
                filterCount={filtersButtonState.filterCount}
                buttonType={filtersButtonState.buttonType as "default" | "primary"}
                onOpenChange={handleFiltersOpenChange}
                popoverProps={{
                    overlayStyle: {
                        backgroundColor: "transparent",
                        boxShadow: "none",
                        padding: 0,
                    },
                    arrow: false,
                    styles: {
                        body: {
                            maxWidth: "360px",
                            backgroundColor: "transparent",
                            boxShadow: "none",
                            border: "none",
                        },
                    },
                }}
                renderContent={(close) => <TestsetsFiltersContent onClose={close} />}
            />
            <TestsetsFiltersSummary />
        </div>
    )
}

export default TestsetsHeaderFilters
