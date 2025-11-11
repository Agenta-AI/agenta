import {memo} from "react"

import JSON5 from "json5"

import TextControl from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/TextControl"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import useEvalRunScenarioData from "@/oss/lib/hooks/useEvaluationRunData/useEvalRunScenarioData"

import {renderChatMessages} from "../../../assets/renderChatMessages"

interface InvocationInputsProps {
    scenarioId: string
    testcaseId: string | undefined
    runId?: string
}

const InvocationInputs = ({scenarioId, testcaseId, runId}: InvocationInputsProps) => {
    const data = useEvalRunScenarioData(scenarioId, runId)
    // Prefer the inputStep directly enriched with `inputs` field (added during bulk/enrichment)
    const inputStep =
        data?.inputSteps?.find((s) => s.testcaseId === testcaseId) ??
        data?.steps?.find((s) => s.testcaseId === testcaseId && s.inputs)
    const inputs = inputStep?.inputs ?? {}
    const groundTruth = (inputStep as any)?.groundTruth ?? {}

    // Merge inputs and groundTruth, giving preference to explicit inputs if duplicate keys
    const displayInputs = {...groundTruth, ...inputs}

    if (!displayInputs || Object.keys(displayInputs).length === 0) return null

    // Separate inputs into primitives, JSON objects/arrays, and chat messages
    const primitiveEntries: [string, string][] = []
    const jsonEntries: [string, any][] = []
    const chatEntries: [string, string][] = []

    Object.entries(displayInputs).forEach(([k, _v]) => {
        // If already an object/array, treat as JSON directly
        if (_v && typeof _v === "object") {
            jsonEntries.push([k, _v])
            return
        }
        // Strings may encode JSON or chat messages
        if (typeof _v === "string") {
            try {
                const parsed = JSON5.parse(_v)
                if (
                    parsed &&
                    Array.isArray(parsed) &&
                    parsed.every(
                        (m: any) => m && typeof m === "object" && "role" in m && "content" in m,
                    )
                ) {
                    chatEntries.push([k, _v])
                } else if (parsed && typeof parsed === "object") {
                    jsonEntries.push([k, parsed])
                } else {
                    primitiveEntries.push([k, _v])
                }
            } catch {
                primitiveEntries.push([k, _v])
            }
            return
        }
        // Fallback to primitive string rendering
        primitiveEntries.push([k, String(_v)])
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

    const renderJson = ([k, obj]: [string, any]) => (
        <section key={k} className="w-full flex flex-col gap-2">
            <SharedEditor
                initialValue={obj}
                state="readOnly"
                disabled
                editorType="borderless"
                editorProps={{codeOnly: true}}
                className="!text-xs"
            />
        </section>
    )

    return (
        <div className="flex flex-col gap-2">
            {/* Render primitives first */}
            {primitiveEntries.map(renderPrimitive)}
            {/* Then structured JSON objects/arrays */}
            {jsonEntries.map(renderJson)}
            {/* Then complex chat/message inputs */}
            {chatEntries.flatMap(renderComplex)}
        </div>
    )
}

export default memo(InvocationInputs)
