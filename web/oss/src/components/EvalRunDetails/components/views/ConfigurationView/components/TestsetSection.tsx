import {useMemo, useState} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Form, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {testsetReferenceQueryAtomFamily} from "../../../../atoms/references"
import {runTestsetIdsAtomFamily} from "../../../../atoms/runDerived"
import {simpleTestsetDetailsAtomFamily} from "../../../../atoms/testsetDetails"
import {TestsetTagList} from "../../../references"

import {SectionCard, SectionHeaderRow, SectionSkeleton} from "./SectionPrimitives"

const {Text} = Typography

interface TestsetSectionProps {
    runId: string
}

const TestsetSection = ({runId}: TestsetSectionProps) => {
    const testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId), [runId]))

    if (!testsetIds.length) {
        return null
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
                left={
                    <TestsetTagList
                        ids={[testsetId]}
                        runId={runId}
                        className="-mt-2"
                        toneOverride={null}
                    />
                }
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
                            <Text className="font-medium text-neutral-800">Testcases</Text>
                            <Tag className="!m-0 !bg-[#EEF2FF] !border-[#E0EAFF] !text-[#344054]">
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
                                        className="!m-0 !bg-[#F2F4F7] !border-[#E4E7EC] !text-[#344054]"
                                    >
                                        {col}
                                    </Tag>
                                ))}
                                {remainingColumnCount > 0 ? (
                                    <Tag className="!m-0 !bg-[#F2F4F7] !border-[#E4E7EC] !text-[#344054]">
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
