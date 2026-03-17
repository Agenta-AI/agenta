/**
 * AnnotationTestcaseContent
 *
 * OSS renderer for testcase data in the annotation session.
 * Renders each testcase field as a collapsible TraceSpanDrillInView panel
 * with format switching (JSON/YAML/Text/Markdown/Rendered).
 *
 * Injected into @agenta/annotation-ui via the TestcaseContentRenderer
 * context slot — see AnnotationUIContext.
 */

import {memo, useEffect, useMemo, useState} from "react"

import type {TestcaseContentRendererProps} from "@agenta/annotation-ui"
import {fetchTestcase} from "@agenta/entities/testcase"
import type {Testcase} from "@agenta/entities/testcase"
import {projectIdAtom} from "@agenta/shared/state"
import {Skeleton, Space, Typography} from "antd"
import {useAtomValue} from "jotai"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"

// ============================================================================
// KEY CATEGORIZATION (same sets used in ScenarioContent)
// ============================================================================

const OUTPUT_KEYS = new Set(["output", "outputs", "result", "response", "completion"])

const EXPECTED_OUTPUT_KEYS = new Set([
    "expected_output",
    "expected",
    "reference",
    "reference_output",
    "ground_truth",
    "golden",
    "target",
    "correct_answer",
])

type FieldCategory = "input" | "output" | "expected"

function categorizeField(key: string): FieldCategory {
    if (OUTPUT_KEYS.has(key)) return "output"
    if (EXPECTED_OUTPUT_KEYS.has(key)) return "expected"
    return "input"
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const AnnotationTestcaseContent = memo(function AnnotationTestcaseContent({
    testcaseId,
}: TestcaseContentRendererProps) {
    const projectId = useAtomValue(projectIdAtom)

    const [testcase, setTestcase] = useState<Testcase | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!projectId || !testcaseId) {
            setIsLoading(false)
            setError("Missing project or testcase ID")
            return
        }

        let cancelled = false
        setIsLoading(true)
        setError(null)

        fetchTestcase({projectId, testcaseId}).then((result) => {
            if (cancelled) return
            if (result) {
                setTestcase(result)
            } else {
                setError("Testcase data not available")
            }
            setIsLoading(false)
        })

        return () => {
            cancelled = true
        }
    }, [projectId, testcaseId])

    // Categorize testcase data fields
    const {inputFields, outputFields, expectedFields} = useMemo(() => {
        const data = testcase?.data
        if (!data || typeof data !== "object") {
            return {inputFields: [], outputFields: [], expectedFields: []}
        }

        const inputs: [string, unknown][] = []
        const outputs: [string, unknown][] = []
        const expected: [string, unknown][] = []

        for (const [key, value] of Object.entries(data)) {
            const category = categorizeField(key)
            if (category === "output") outputs.push([key, value])
            else if (category === "expected") expected.push([key, value])
            else inputs.push([key, value])
        }

        return {inputFields: inputs, outputFields: outputs, expectedFields: expected}
    }, [testcase])

    if (isLoading) {
        return (
            <div className="p-4">
                <Skeleton active paragraph={{rows: 4}} />
            </div>
        )
    }

    if (error || !testcase) {
        return (
            <div className="flex items-center justify-center py-10">
                <Typography.Text type="secondary">
                    {error || "Testcase data not available"}
                </Typography.Text>
            </div>
        )
    }

    const hasData = inputFields.length > 0 || outputFields.length > 0 || expectedFields.length > 0

    if (!hasData) {
        return (
            <div className="flex items-center justify-center py-10">
                <Typography.Text type="secondary">
                    No data available for this testcase
                </Typography.Text>
            </div>
        )
    }

    return (
        <div className="w-full flex flex-col gap-2">
            {/* Input fields */}
            {inputFields.length > 0 && (
                <Space direction="vertical" className="w-full" size={8}>
                    {inputFields.map(([key, value]) => (
                        <TraceSpanDrillInView
                            key={`input-${key}`}
                            spanId={testcaseId}
                            title={key}
                            editable={false}
                            rootScope="span"
                            spanDataOverride={value}
                        />
                    ))}
                </Space>
            )}

            {/* Expected output fields */}
            {expectedFields.length > 0 && (
                <Space direction="vertical" className="w-full" size={8}>
                    {expectedFields.map(([key, value]) => (
                        <TraceSpanDrillInView
                            key={`expected-${key}`}
                            spanId={testcaseId}
                            title={key}
                            editable={false}
                            rootScope="span"
                            spanDataOverride={value}
                        />
                    ))}
                </Space>
            )}

            {/* Output fields */}
            {outputFields.length > 0 && (
                <Space direction="vertical" className="w-full" size={8}>
                    {outputFields.map(([key, value]) => (
                        <TraceSpanDrillInView
                            key={`output-${key}`}
                            spanId={testcaseId}
                            title={key}
                            editable={false}
                            rootScope="span"
                            spanDataOverride={value}
                        />
                    ))}
                </Space>
            )}
        </div>
    )
})

export default AnnotationTestcaseContent
