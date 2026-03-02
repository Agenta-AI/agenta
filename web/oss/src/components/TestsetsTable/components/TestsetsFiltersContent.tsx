import {useCallback, useEffect, useMemo, useState} from "react"

import {Button, Divider, Typography} from "antd"
import {useAtom} from "jotai"

import QuickDateRangePicker from "@/oss/components/EvaluationRunsTablePOC/components/filters/QuickDateRangePicker"

import {
    testsetsDateCreatedFilterAtom,
    testsetsDateModifiedFilterAtom,
    type TestsetDateRange,
} from "../atoms/filters"

interface TestsetsFiltersContentProps {
    onClose: () => void
}

type RangeValue = {from?: string | null; to?: string | null} | null

const sectionClass = "flex flex-col gap-2"

const SectionTitle = ({children}: {children: React.ReactNode}) => (
    <Typography.Text strong className="text-gray-700">
        {children}
    </Typography.Text>
)

const Section = ({title, children}: {title: React.ReactNode; children: React.ReactNode}) => (
    <div className={sectionClass}>
        <SectionTitle>{title}</SectionTitle>
        {children}
    </div>
)

const normalizeRange = (range: TestsetDateRange | null): string => {
    if (!range) return "null"
    return JSON.stringify({from: range.from ?? null, to: range.to ?? null})
}

const TestsetsFiltersContent = ({onClose}: TestsetsFiltersContentProps) => {
    const [dateCreatedFilter, setDateCreatedFilter] = useAtom(testsetsDateCreatedFilterAtom)
    const [dateModifiedFilter, setDateModifiedFilter] = useAtom(testsetsDateModifiedFilterAtom)

    // Draft state for tracking changes
    const [draftDateCreated, setDraftDateCreated] = useState<TestsetDateRange | null>(
        dateCreatedFilter,
    )
    const [draftDateModified, setDraftDateModified] = useState<TestsetDateRange | null>(
        dateModifiedFilter,
    )

    // Sync draft with persisted state when popover opens
    useEffect(() => {
        setDraftDateCreated(dateCreatedFilter)
        setDraftDateModified(dateModifiedFilter)
    }, [dateCreatedFilter, dateModifiedFilter])

    const handleDateCreatedChange = useCallback((range: RangeValue) => {
        if (!range) {
            setDraftDateCreated(null)
            return
        }
        setDraftDateCreated({
            from: range.from ?? null,
            to: range.to ?? null,
        })
    }, [])

    const handleDateModifiedChange = useCallback((range: RangeValue) => {
        if (!range) {
            setDraftDateModified(null)
            return
        }
        setDraftDateModified({
            from: range.from ?? null,
            to: range.to ?? null,
        })
    }, [])

    const handleReset = useCallback(() => {
        setDraftDateCreated(null)
        setDraftDateModified(null)
        setDateCreatedFilter(null)
        setDateModifiedFilter(null)
    }, [setDateCreatedFilter, setDateModifiedFilter])

    const handleApply = useCallback(() => {
        setDateCreatedFilter(draftDateCreated)
        setDateModifiedFilter(draftDateModified)
        onClose()
    }, [draftDateCreated, draftDateModified, setDateCreatedFilter, setDateModifiedFilter, onClose])

    const hasPendingChanges = useMemo(() => {
        const createdChanged =
            normalizeRange(draftDateCreated) !== normalizeRange(dateCreatedFilter)
        const modifiedChanged =
            normalizeRange(draftDateModified) !== normalizeRange(dateModifiedFilter)
        return createdChanged || modifiedChanged
    }, [draftDateCreated, draftDateModified, dateCreatedFilter, dateModifiedFilter])

    return (
        <div className="flex flex-col gap-4 p-4 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[280px]">
            <div className="flex flex-col gap-3">
                <Section title="Date Created">
                    <QuickDateRangePicker
                        value={draftDateCreated}
                        onChange={handleDateCreatedChange}
                    />
                </Section>

                <Section title="Date Modified">
                    <QuickDateRangePicker
                        value={draftDateModified}
                        onChange={handleDateModifiedChange}
                    />
                </Section>
            </div>

            <Divider className="!my-0" />
            <div className="flex justify-end gap-2">
                <Button type="link" onClick={handleReset}>
                    Reset
                </Button>
                <Button type="primary" onClick={handleApply} disabled={!hasPendingChanges}>
                    Apply
                </Button>
            </div>
        </div>
    )
}

export default TestsetsFiltersContent
