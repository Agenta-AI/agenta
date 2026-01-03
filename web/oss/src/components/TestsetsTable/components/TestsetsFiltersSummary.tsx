import type {MouseEvent} from "react"

import {Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    testsetsDateCreatedFilterAtom,
    testsetsDateModifiedFilterAtom,
    testsetsFiltersSummaryAtom,
} from "../atoms/filters"

const formatDateLabel = (value?: string | null) => {
    if (!value) return null
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        }).format(new Date(value))
    } catch {
        return value
    }
}

const TestsetsFiltersSummary = () => {
    const summary = useAtomValue(testsetsFiltersSummaryAtom)
    const setDateCreatedFilter = useSetAtom(testsetsDateCreatedFilterAtom)
    const setDateModifiedFilter = useSetAtom(testsetsDateModifiedFilterAtom)

    const handleRemoveDateCreated = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        setDateCreatedFilter(null)
    }

    const handleRemoveDateModified = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        setDateModifiedFilter(null)
    }

    if (!summary.hasFilters) {
        return (
            <Typography.Text className="text-xs text-[#98A2B3] whitespace-nowrap">
                No filters applied
            </Typography.Text>
        )
    }

    return (
        <div className="flex gap-2 text-xs text-[#475467] grow overflow-x-auto">
            {summary.dateCreated && (
                <Tag
                    closable
                    onClose={handleRemoveDateCreated}
                    className="m-0 px-2 py-0.5 text-xs border border-solid rounded text-[#475467] bg-[#F2F4F7] border-transparent"
                >
                    <span>
                        <span className="font-medium text-[#101828]">Date Created:</span>{" "}
                        {formatDateLabel(summary.dateCreated.from)} -{" "}
                        {formatDateLabel(summary.dateCreated.to)}
                    </span>
                </Tag>
            )}
            {summary.dateModified && (
                <Tag
                    closable
                    onClose={handleRemoveDateModified}
                    className="m-0 px-2 py-0.5 text-xs border border-solid rounded text-[#475467] bg-[#F2F4F7] border-transparent"
                >
                    <span>
                        <span className="font-medium text-[#101828]">Date Modified:</span>{" "}
                        {formatDateLabel(summary.dateModified.from)} -{" "}
                        {formatDateLabel(summary.dateModified.to)}
                    </span>
                </Tag>
            )}
        </div>
    )
}

export default TestsetsFiltersSummary
