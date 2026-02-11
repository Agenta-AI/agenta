import React, {useCallback, useMemo, useState} from "react"

import {MagnifyingGlass} from "@phosphor-icons/react"
import {Button, Divider, Dropdown, Input, Typography} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"

import LLMIconMap from "@/oss/components/LLMIcons"
import {getPromptById, getLLMConfig} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

import AddButton from "../../../assets/AddButton"
import {
    addPromptMessageMutationAtomFamily,
    addPromptToolMutationAtomFamily,
} from "../../../state/atoms/promptMutations"
import {TOOL_PROVIDERS_META} from "../../PlaygroundTool/assets"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"

import TemplateFormatSelector from "./TemplateFormatSelector"
import toolsSpecs from "./tools.specs.json"

interface Props {
    variantId: string
    compoundKey: string
    viewOnly?: boolean
}

const formatToolLabel = (toolCode: string) =>
    toolCode
        .split("_")
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")

const ActionsOutputRenderer: React.FC<Props> = ({variantId, compoundKey, viewOnly}) => {
    const addNewMessage = useSetAtom(addPromptMessageMutationAtomFamily(compoundKey))
    const addNewTool = useSetAtom(addPromptToolMutationAtomFamily(compoundKey))
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    // promptId may contain colons (e.g. "prompt:prompt1"), so split only on the first ":"
    const promptId = compoundKey.substring(compoundKey.indexOf(":") + 1)
    const prompts = usePromptsSource(variantId)

    const responseFormatInfo = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const llm = getLLMConfig(item)
        const enhancedId = llm?.responseFormat?.__id || llm?.response_format?.__id
        const raw = llm?.response_format || llm?.responseFormat

        return {enhancedId, raw}
    }, [prompts, promptId])
    const responseFormatId = responseFormatInfo.enhancedId as string | undefined

    const filteredToolGroups = useMemo(() => {
        const normalizedTerm = searchTerm.trim().toLowerCase()

        return Object.entries(toolsSpecs).reduce<
            {
                key: string
                label: string
                Icon?: React.FC<{className?: string}>
                tools: {code: string; label: string; payload: Record<string, any>}[]
            }[]
        >((groups, [providerKey, tools]) => {
            const meta = TOOL_PROVIDERS_META[providerKey] ?? {label: providerKey}
            const Icon = meta.iconKey ? LLMIconMap[meta.iconKey] : undefined
            const providerMatches =
                normalizedTerm && meta.label.toLowerCase().includes(normalizedTerm)

            const toolEntries = Object.entries(tools).map(([toolCode, toolSpec]) => {
                return {
                    code: toolCode,
                    label: formatToolLabel(toolCode),
                    payload: Array.isArray(toolSpec) ? toolSpec[0] : toolSpec,
                }
            })

            const matchingTools = toolEntries.filter((tool) => {
                if (!normalizedTerm) return true
                const toolMatches =
                    tool.label.toLowerCase().includes(normalizedTerm) ||
                    tool.code.toLowerCase().includes(normalizedTerm)
                return providerMatches || toolMatches
            })

            if (matchingTools.length) {
                groups.push({
                    key: providerKey,
                    label: meta.label,
                    Icon,
                    tools: matchingTools,
                })
            }

            return groups
        }, [])
    }, [searchTerm])

    const handleAddTool = useCallback(
        (params?: {
            payload?: Record<string, any>
            source?: "inline" | "builtin"
            providerKey?: string
            providerLabel?: string
            toolCode?: string
            toolLabel?: string
        }) => {
            addNewTool(params)
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
                    variant="borderless"
                    placeholder="Search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    prefix={<MagnifyingGlass size={16} className="text-[#98A2B3]" />}
                    className="flex-1 !shadow-none !outline-none !border-none focus:!shadow-none focus:!outline-none focus:!border-none"
                />
                <Button
                    type="primary"
                    size="small"
                    className="shrink-0"
                    onClick={() => handleAddTool({source: "inline"})}
                >
                    + Create in-line
                </Button>
            </div>

            <Divider className="m-0" orientation="horizontal" />

            <div className="max-h-64 overflow-y-auto flex flex-col p-1">
                {filteredToolGroups.length > 0 ? (
                    filteredToolGroups.map(({key, label, Icon, tools}) => (
                        <div key={key} className="flex flex-col">
                            <div className="flex items-center py-[5px] px-1.5 h-[28px]">
                                {Icon && (
                                    <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-[#F8FAFC]">
                                        <Icon className="h-4 w-4 text-[#758391]" />
                                    </span>
                                )}
                                <Typography.Text className="text-[#758391]">
                                    {label}
                                </Typography.Text>
                            </div>
                            <div className="flex flex-col">
                                {tools.map(({code, label: toolLabel, payload}) => (
                                    <Button
                                        key={code}
                                        type="text"
                                        block
                                        className="flex h-[28px] items-center gap-2 justify-start text-left py-[5px] px-1.5 hover:!bg-[#F8FAFC]"
                                        onClick={() =>
                                            handleAddTool({
                                                payload,
                                                source: "builtin",
                                                providerKey: key,
                                                providerLabel: label,
                                                toolCode: code,
                                                toolLabel,
                                            })
                                        }
                                    >
                                        <span className="text-[#94A3B8]">•</span>
                                        <span className="text-[#0F172A]">{toolLabel}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="py-8 text-center text-[12px] leading-5 text-[#7E8B99]">
                        No tools found
                    </div>
                )}
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
                        menu={{items: []}}
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
