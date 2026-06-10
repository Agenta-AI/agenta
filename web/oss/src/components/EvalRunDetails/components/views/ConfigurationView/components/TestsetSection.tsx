import {useMemo, useState} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Form, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {testsetReferenceQueryAtomFamily} from "../../../../atoms/references"
import {runTestsetIdsAtomFamily} from "../../../../atoms/runDerived"
import {simpleTestsetDetailsAtomFamily} from "../../../../atoms/testsetDetails"
import {TestsetTagList} from "../../../references"

import {DefList, DefRow, SectionCard, SectionHeaderRow, SectionSkeleton} from "./SectionPrimitives"

const {Text} = Typography

interface TestsetSectionProps {
    runId: string
    /** V2 layout: render definition-list rows only (the shell owns the card). */
    embedded?: boolean
    /** Compare mode: the test set differs from the base run. */
    differs?: boolean
}

const TestsetSection = ({runId, embedded = false, differs = false}: TestsetSectionProps) => {
    const testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId), [runId]))

    if (!testsetIds.length) {
        return null
    }

    if (embedded) {
        return (
            <div className="flex flex-col gap-4">
                {testsetIds.map((id) => (
                    <EmbeddedTestsetRows key={id} runId={runId} testsetId={id} differs={differs} />
                ))}
            </div>
        )
    }

    return (
        <Form layout="vertical" requiredMark={false}>
            <div className="flex flex-col gap-4">
                {testsetIds.map((id, index) => (
                    <TestsetCard key={id} runId={runId} testsetId={id} index={index} />
                ))}
            </div>
        </Form>
    )
}

const EmbeddedTestsetRows = ({
    runId,
    testsetId,
    differs,
}: {
    runId: string
    testsetId: string
    differs: boolean
}) => {
    const simpleAtom = useMemo(() => simpleTestsetDetailsAtomFamily(testsetId), [testsetId])
    const simpleQuery = useAtomValue(simpleAtom)
    const simple = simpleQuery.data

    const testcaseCount =
        typeof simple?.testcaseCount === "number" && simple.testcaseCount >= 0
            ? simple.testcaseCount
            : null
    const columns = simple?.columnNames && simple.columnNames.length ? simple.columnNames : null

    return (
        <DefList>
            <DefRow label="Test set" differs={differs}>
                <TestsetTagList ids={[testsetId]} runId={runId} />
            </DefRow>
            <DefRow label="Test cases">
                <span className="text-[13px] font-medium [font-variant-numeric:tabular-nums]">
                    {testcaseCount ?? "—"}
                </span>
            </DefRow>
            <DefRow label="Columns">
                {columns ? (
                    columns.map((col) => (
                        <Tag key={`${testsetId}-${col}`} className="!m-0 font-mono text-[11px]">
                            {col}
                        </Tag>
                    ))
                ) : (
                    <Text type="secondary">No column metadata.</Text>
                )}
            </DefRow>
            {simple?.description ? (
                <DefRow label="Description">
                    <Text type="secondary" className="leading-5">
                        {simple.description}
                    </Text>
                </DefRow>
            ) : null}
        </DefList>
    )
}

const TestsetCard = ({
    runId,
    testsetId,
    index,
}: {
    runId: string
    testsetId: string
    index: number
}) => {
    const [collapsed, setCollapsed] = useState(false)
    const referenceAtom = useMemo(() => testsetReferenceQueryAtomFamily(testsetId), [testsetId])
    const simpleAtom = useMemo(() => simpleTestsetDetailsAtomFamily(testsetId), [testsetId])
    const referenceQuery = useAtomValue(referenceAtom)
    const simpleQuery = useAtomValue(simpleAtom)

    const isLoading =
        ((referenceQuery.isPending || referenceQuery.isFetching) && !referenceQuery.isError) ||
        ((simpleQuery.isPending || simpleQuery.isFetching) && !simpleQuery.isError)

    const simple = simpleQuery.data

    const testcaseCount =
        typeof simple?.testcaseCount === "number" && simple.testcaseCount >= 0
            ? simple.testcaseCount
            : null
    const columns =
        simple?.columnNames && simple.columnNames.length ? simple.columnNames : undefined
    const columnPreview = columns && columns.length > 0 ? columns.slice(0, 3) : []
    const remainingColumnCount =
        columns && columns.length > columnPreview.length ? columns.length - columnPreview.length : 0

    if (isLoading) {
        return <SectionSkeleton lines={3} />
    }

    return (
        <SectionCard>
            <SectionHeaderRow
                left={<TestsetTagList ids={[testsetId]} runId={runId} className="-mt-2" />}
                right={
                    <Button
                        type="text"
                        size="small"
                        icon={<DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />}
                        onClick={() => setCollapsed((v) => !v)}
                    />
                }
            />
            {!collapsed ? (
                <div className="flex flex-col gap-3 mt-1">
                    {simple?.description ? (
                        <Text type="secondary" className="leading-5">
                            {simple.description}
                        </Text>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Text className="font-medium text-neutral-800">Test cases</Text>
                            <Tag className="!m-0 !bg-[var(--ag-c-EEF2FF)] !border-[var(--ag-c-E0EAFF)] !text-[var(--ag-c-344054)]">
                                {testcaseCount ?? "—"}
                            </Tag>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <Text className="font-medium text-neutral-800">Column preview</Text>
                        {columns && columns.length ? (
                            <div className="flex flex-wrap gap-2">
                                {columnPreview.map((col) => (
                                    <Tag
                                        key={`${testsetId}-${col}`}
                                        className="!m-0 !bg-[var(--ag-c-F2F4F7)] !border-[var(--ag-c-E4E7EC)] !text-[var(--ag-c-344054)]"
                                    >
                                        {col}
                                    </Tag>
                                ))}
                                {remainingColumnCount > 0 ? (
                                    <Tag className="!m-0 !bg-[var(--ag-c-F2F4F7)] !border-[var(--ag-c-E4E7EC)] !text-[var(--ag-c-344054)]">
                                        +{remainingColumnCount} more
                                    </Tag>
                                ) : null}
                            </div>
                        ) : (
                            <Text type="secondary">No column metadata.</Text>
                        )}
                    </div>
                </div>
            ) : null}
        </SectionCard>
    )
}

export default TestsetSection
