import {useCallback, useMemo, type MouseEvent} from "react"

import {Form, Typography} from "antd"
import {useAtomValue} from "jotai"

import {message} from "@/oss/components/AppMessageContext"

import {testsetReferenceQueryAtomFamily} from "../../../../atoms/references"
import {runTestsetIdsAtomFamily} from "../../../../atoms/runDerived"
import {simpleTestsetDetailsAtomFamily} from "../../../../atoms/testsetDetails"
import {TestsetTagList} from "../../../reference"

import {ReadOnlySkeleton} from "./CopyableFields"
import {SectionCard, SectionHeaderRow} from "./SectionPrimitives"

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
            {/* <Form.Item label="Linked test sets" style={{marginBottom: 16}}>
                <TestsetTagList ids={testsetIds} runId={runId} />
            </Form.Item> */}
            <div className="flex flex-col gap-3">
                {testsetIds.map((id, index) => (
                    <SectionCard key={id}>
                        <TestsetHeader runId={runId} testsetId={id} index={index} />
                        <div className="mt-2">
                            <TestsetBody testsetId={id} />
                        </div>
                    </SectionCard>
                ))}
            </div>
        </Form>
    )
}

const TestsetHeader = ({
    runId,
    testsetId,
    index,
}: {
    runId: string
    testsetId: string
    index: number
}) => {
    const handleCopy = useCallback(
        async (e: MouseEvent) => {
            // Prevent navigating when clicking label (ReferenceTag renders an anchor)
            e.preventDefault()
            e.stopPropagation()
            try {
                await navigator.clipboard.writeText(testsetId)
                message.success("Copied testset ID")
            } catch (err) {
                message.error("Failed to copy")
            }
        },
        [testsetId],
    )

    return (
        <SectionHeaderRow
            left={
                <Text className="font-medium text-neutral-900 truncate" onClick={handleCopy}>
                    <TestsetTagList ids={[testsetId]} runId={runId} />
                </Text>
            }
        />
    )
}

const TestsetBody = ({testsetId}: {testsetId: string}) => {
    const atom = useMemo(() => testsetReferenceQueryAtomFamily(testsetId), [testsetId])
    const simpleAtom = useMemo(() => simpleTestsetDetailsAtomFamily(testsetId), [testsetId])
    const query = useAtomValue(atom)
    const simpleQuery = useAtomValue(simpleAtom)

    const isLoading =
        query.isPending || query.isFetching || simpleQuery.isPending || simpleQuery.isFetching

    const ref = query.data
    const simple = simpleQuery.data

    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
        console.info("[ConfigurationView][TestsetField]", {
            testsetId,
            reference: ref,
            simple,
        })
    }

    // const id = simple?.id ?? ref?.id ?? testsetId
    // const name = simple?.name ?? ref?.name ?? undefined

    const testcaseCount =
        typeof simple?.testcaseCount === "number" && simple.testcaseCount >= 0
            ? simple.testcaseCount
            : null
    const columns =
        simple?.columnNames && simple.columnNames.length ? simple.columnNames : undefined
    const columnPreview = columns && columns.length > 0 ? columns.slice(0, 3) : []
    const remainingColumnCount =
        columns && columns.length > columnPreview.length ? columns.length - columnPreview.length : 0

    return isLoading ? (
        <ReadOnlySkeleton />
    ) : (
        <div className="flex flex-col gap-1">
            <Text className="text-sm text-neutral-600">
                Test cases: {testcaseCount ?? "—"}
                {columnPreview.length ? ` • ${columnPreview.join(", ")}` : ""}
                {remainingColumnCount > 0 ? ` +${remainingColumnCount} more` : ""}
            </Text>
        </div>
    )
}

export default TestsetSection
