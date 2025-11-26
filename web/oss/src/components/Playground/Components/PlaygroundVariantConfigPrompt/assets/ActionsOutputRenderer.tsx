import React, {useCallback, useMemo, useState} from "react"

import clsx from "clsx"
import {useSetAtom} from "jotai"
import {Button, Divider, Dropdown, Input, Typography} from "antd"

import {getPromptById, getLLMConfig} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

import AddButton from "../../../assets/AddButton"
import {
    addPromptMessageMutationAtomFamily,
    addPromptToolMutationAtomFamily,
} from "../../../state/atoms/promptMutations"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"
import TemplateFormatSelector from "./TemplateFormatSelector"
import toolsSpecs from "./tools.specs.json"

interface Props {
    variantId: string
    compoundKey: string
    viewOnly?: boolean
}

const ActionsOutputRenderer: React.FC<Props> = ({variantId, compoundKey, viewOnly}) => {
    const addNewMessage = useSetAtom(addPromptMessageMutationAtomFamily(compoundKey))
    const addNewTool = useSetAtom(addPromptToolMutationAtomFamily(compoundKey))
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [, promptId] = compoundKey.split(":", 2)
    const prompts = usePromptsSource(variantId)

    const responseFormatInfo = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const llm = getLLMConfig(item)
        const enhancedId = llm?.responseFormat?.__id || llm?.response_format?.__id
        const raw = llm?.response_format || llm?.responseFormat
        return {enhancedId, raw}
    }, [prompts, promptId])
    const responseFormatId = responseFormatInfo.enhancedId as string | undefined

    // const filteredToolOptions = useMemo(() => {
    //     if (!searchTerm) return MOCK_TOOL_OPTIONS
    //     const lowerTerm = searchTerm.toLowerCase()
    //     return MOCK_TOOL_OPTIONS.filter(
    //         (tool) =>
    //             tool.name.toLowerCase().includes(lowerTerm) ||
    //             tool.toolCode.toLowerCase().includes(lowerTerm) ||
    //             tool.description.toLowerCase().includes(lowerTerm),
    //     )
    // }, [searchTerm])

    const handleAddTool = useCallback(
        (payload?: Record<string, any>) => {
            addNewTool(payload)
            setIsDropdownOpen(false)
            setSearchTerm("")
        },
        [addNewTool],
    )

    const dropdownContent = (
        <div className={clsx("w-[280px] bg-white rounded-lg shadow-lg", "flex flex-col")}>
            <div className="flex items-center gap-2 p-2">
                <Input
                    allowClear
                    autoFocus
                    placeholder="Search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="flex-1 border-none outline-none"
                />
                <Button
                    type="primary"
                    size="small"
                    className="shrink-0"
                    onClick={() => handleAddTool()}
                >
                    + Create in-line
                </Button>
            </div>

            <Divider className="m-0" type="horizontal" />

            <div className="max-h-64 overflow-y-auto flex flex-col p-2">
                {Object.entries(toolsSpecs).map(([llm, tools], index) => {
                    return (
                        <div key={index}>
                            <Typography.Text>{llm}</Typography.Text>
                            {Object.entries(tools).map(([toolCode, tool], index) => {
                                return (
                                    <Button
                                        key={index}
                                        type="text"
                                        block
                                        className="justify-start text-left"
                                        onClick={() =>
                                            handleAddTool(Array.isArray(tool) ? tool[0] : tool)
                                        }
                                    >
                                        <span className="text-[#0F172A]">{toolCode}</span>
                                    </Button>
                                )
                            })}
                        </div>
                    )
                })}

                {/* {filteredToolOptions.length === 0 && (
                    <div className="text-center text-[12px] leading-5 text-[#7E8B99]">
                        No tools found
                    </div>
                )} */}
            </div>
        </div>
    )

    return (
        <div
            className={clsx(["flex gap-1 flex-wrap w-full", "mb-6"], {
                "[&>_div]:!w-full": viewOnly,
            })}
        >
            {!viewOnly && (
                <>
                    <AddButton
                        className="mt-2"
                        size="small"
                        label="Message"
                        onClick={addNewMessage}
                    />
                    <Dropdown
                        open={isDropdownOpen}
                        onOpenChange={setIsDropdownOpen}
                        trigger={["click"]}
                        popupRender={() => dropdownContent}
                        placement="bottomLeft"
                    >
                        <AddButton
                            className="mt-2"
                            size="small"
                            label="Tool"
                            onClick={() => setIsDropdownOpen(true)}
                        />
                    </Dropdown>
                </>
            )}
            <div>
                {responseFormatId ? (
                    <PlaygroundVariantPropertyControl
                        variantId={variantId}
                        propertyId={responseFormatId}
                        viewOnly={viewOnly}
                        disabled={viewOnly}
                        className="!min-h-0 [&_div]:!mb-0"
                    />
                ) : (
                    // Fallback for immutable/raw params (no property id)
                    <span className="text-[#7E8B99] text-[12px] leading-[20px] block">
                        {(() => {
                            const t = (responseFormatInfo.raw || {})?.type
                            if (!t || t === "text") return "Default (text)"
                            if (t === "json_object") return "JSON mode"
                            if (t === "json_schema") return "JSON schema"
                            return String(t)
                        })()}
                    </span>
                )}
            </div>
            <TemplateFormatSelector variantId={variantId} disabled={viewOnly} />
        </div>
    )
}

export default ActionsOutputRenderer
