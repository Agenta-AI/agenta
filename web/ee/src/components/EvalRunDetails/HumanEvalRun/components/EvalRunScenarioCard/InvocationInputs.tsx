import {memo} from "react"

import TextControl from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/TextControl"
import useEvalRunScenarioData from "@/oss/lib/hooks/useEvaluationRunData/useEvalRunScenarioData"

import {renderChatMessages} from "../../../assets/renderChatMessages"

interface InvocationInputsProps {
    scenarioId: string
    testcaseId: string | undefined
}

const InvocationInputs = ({scenarioId, testcaseId}: InvocationInputsProps) => {
    const data = useEvalRunScenarioData(scenarioId)
    // Prefer the inputStep directly enriched with `inputs` field (added during bulk/enrichment)
    const inputStep =
        data?.inputSteps?.find((s) => s.testcaseId === testcaseId) ??
        data?.steps?.find((s) => s.testcaseId === testcaseId && s.inputs)
    const inputs = inputStep?.inputs ?? {}
    const groundTruth = (inputStep as any)?.groundTruth ?? {}

    // Merge inputs and groundTruth, giving preference to explicit inputs if duplicate keys
    const displayInputs = {...groundTruth, ...inputs}

    if (!displayInputs || Object.keys(displayInputs).length === 0) return null

    // Separate primitive vs complex (chat messages) inputs to control rendering order
    const primitiveEntries: [string, string][] = []
    const complexEntries: [string, string][] = []

    Object.entries(displayInputs).forEach(([k, _v]) => {
        try {
            const parsed = JSON.parse(_v as string)
            if (
                parsed &&
                Array.isArray(parsed) &&
                parsed.every((m: any) => "role" in m && "content" in m)
            ) {
                complexEntries.push([k, _v as string])
            } else {
                primitiveEntries.push([k, _v as string])
            }
        } catch {
            primitiveEntries.push([k, _v as string])
        }
    })

    const renderPrimitive = ([k, v]: [string, string]) => (
        <section key={k} className="w-full flex flex-col gap-2">
            <TextControl
                metadata={{title: k}}
                value={v}
                handleChange={() => {}}
                disabled
                state="readOnly"
                className="!text-xs"
            />
        </section>
    )

    // Render complex chat message inputs using shared util
    const renderComplex = ([k, v]: [string, string]) =>
        renderChatMessages({keyPrefix: k, rawJson: v, view: "single"})

    return (
        <div className="flex flex-col gap-2">
            {/* Render primitives first */}
            {primitiveEntries.map(renderPrimitive)}
            {/* Then complex chat/message inputs */}
            {complexEntries.flatMap(renderComplex)}
        </div>
    )
}

export default memo(InvocationInputs)
