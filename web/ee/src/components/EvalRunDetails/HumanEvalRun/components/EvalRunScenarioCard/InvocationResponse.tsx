import {memo} from "react"

import {Typography} from "antd"

import GenerationResultUtils from "@/oss/components/Playground/Components/PlaygroundGenerations/assets/GenerationResultUtils"
import SimpleDropdownSelect from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"

import RunEvalScenarioButton from "../RunEvalScenarioButton"

import {InvocationResponseProps} from "./types"

const InvocationResponse = ({scenarioId, stepKey}: InvocationResponseProps) => {
    const {status, trace, value, messageNodes} = useInvocationResult({scenarioId, stepKey})

    return (
        <section className="w-full flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Typography.Title level={4} className="!font-medium !m-0">
                    Model Response
                </Typography.Title>
                <RunEvalScenarioButton stepKey={stepKey} scenarioId={scenarioId} />
            </div>

            {messageNodes ? (
                messageNodes
            ) : typeof value === "object" && value && "role" in value && "content" in value ? (
                <SharedEditor
                    state="readOnly"
                    header={
                        <div className="w-full flex items-center justify-between">
                            <SimpleDropdownSelect
                                value={(value as any).role}
                                options={[
                                    {label: "user", value: "user"},
                                    {label: "assistant", value: "assistant"},
                                    {label: "system", value: "system"},
                                    {label: "function", value: "function"},
                                    {label: "tool", value: "tool"},
                                ]}
                                onChange={() => {}}
                                disabled
                            />
                        </div>
                    }
                    initialValue={(value as any).content}
                    editorClassName="!text-xs"
                    disabled
                    error={!!trace?.exception}
                />
            ) : typeof value === "object" ? (
                <SharedEditor
                    handleChange={() => {}}
                    initialValue={value}
                    editorType="border"
                    placeholder="Click the 'Run' icon to get variant output"
                    disabled
                    editorClassName="!text-xs"
                    editorProps={{enableResize: true, codeOnly: true}}
                    error={!!trace?.exception}
                />
            ) : (
                <SharedEditor
                    handleChange={() => {}}
                    initialValue={status?.error ? String(status.error) : (value ?? status?.result)}
                    editorType="border"
                    placeholder="Click the 'Run' icon to get variant output"
                    disabled
                    editorClassName="!text-xs"
                    editorProps={{enableResize: true}}
                    error={!!trace?.exception}
                />
            )}
            {trace ? (
                <GenerationResultUtils
                    result={{
                        response: {
                            tree: {
                                nodes: [trace],
                            },
                        },
                    }}
                />
            ) : null}
        </section>
    )
}

export default memo(InvocationResponse)
