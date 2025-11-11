import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Input, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import JSON5 from "json5"
import {v4 as uuidv4} from "uuid"

import {EditorProvider} from "@/oss/components/Editor/Editor"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControl/assets/PlaygroundVariantPropertyControlWrapper"
import PromptMessageContentOptions from "../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"
import SharedEditor from "../SharedEditor"

import {TOOL_SCHEMA} from "./assets"

const PlaygroundTool = ({value, disabled, variantId, baseProperty, ...editorProps}) => {
    const editorIdRef = useRef(uuidv4())
    const isReadOnly = Boolean(disabled)
    const [minimized, setMinimized] = useState(false)
    const [toolString, setToolString] = useState(() => {
        try {
            return typeof value === "string" ? value : JSON5.stringify(value)
        } catch (e) {
            return null
        }
    })
    const [functionName, setFunctionName] = useState(() => {
        try {
            return typeof value === "string"
                ? JSON5.parse(value)?.function?.name
                : value?.function?.name
        } catch (err) {
            return null
        }
    })
    const [functionDescription, setFunctionDescription] = useState(() => {
        try {
            return typeof value === "string"
                ? JSON5.parse(value)?.function?.description
                : value?.function?.description
        } catch (err) {
            return null
        }
    })

    const parsed = useMemo(() => {
        if (!toolString) return null
        try {
            return JSON5.parse(toolString)
        } catch (e) {
            return null
        }
    }, [toolString])

    useEffect(() => {
        if (isReadOnly || !toolString) {
            return
        }

        try {
            const toolObj = JSON5.parse(toolString)
            if (toolObj && toolObj.function) {
                toolObj.function.name = functionName
            }
            setToolString(JSON.stringify(toolObj))
        } catch (err) {
            console.error(err)
        }
    }, [functionName, isReadOnly, toolString])

    useEffect(() => {
        if (isReadOnly || !toolString) {
            return
        }

        try {
            const toolObj = JSON5.parse(toolString)
            if (toolObj && toolObj.function) {
                toolObj.function.description = functionDescription
            }

            setToolString(JSON.stringify(toolObj))
        } catch (err) {
            console.error(err)
        }
    }, [functionDescription, isReadOnly, toolString])

    useEffect(() => {
        if (isReadOnly) return

        try {
            const parsedTool = JSON5.parse(toolString)
            editorProps?.handleChange?.(parsedTool)
            setFunctionName((currentName) => {
                if (currentName !== parsedTool?.function?.name) {
                    return parsedTool?.function?.name
                }
                return currentName
            })
            setFunctionDescription((currentDescription) => {
                if (currentDescription !== parsedTool?.function?.description) {
                    return parsedTool?.function?.description
                }
                return currentDescription
            })
        } catch (e) {
            if (!toolString) {
                setFunctionName(null)
                setFunctionDescription(null)
            }
        }
    }, [toolString, isReadOnly])

    // Use atom-based state management for direct prompt updates via derived prompts
    const variant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
    const appUriInfo = useAtomValue(appUriInfoAtom)
    const setPrompts = useSetAtom(
        useMemo(() => promptsAtomFamily(variantId), [variant, variantId, appUriInfo?.routePath]),
    )

    const deleteMessage = useCallback(() => {
        if (isReadOnly) return
        if (!baseProperty?.__id) {
            console.warn("Cannot delete tool: tool property ID not found")
            return
        }

        setPrompts((prevPrompts: any[] = []) => {
            return prevPrompts.map((prompt: any) => {
                const toolsArr = prompt?.llmConfig?.tools?.value
                if (Array.isArray(toolsArr)) {
                    const updatedTools = toolsArr.filter(
                        (tool: any) => tool.__id !== baseProperty.__id,
                    )
                    if (updatedTools.length !== toolsArr.length) {
                        return {
                            ...prompt,
                            llmConfig: {
                                ...prompt.llmConfig,
                                tools: {
                                    ...prompt.llmConfig.tools,
                                    value: updatedTools,
                                },
                            },
                        }
                    }
                }
                return prompt
            })
        })
    }, [isReadOnly, variantId, baseProperty?.__id, setPrompts])

    return (
        <PlaygroundVariantPropertyControlWrapper
            className={clsx(
                "w-full max-w-full overflow-y-auto flex [&_>_div]:!w-auto [&_>_div]:!grow !my-0",
                {
                    "[_.agenta-shared-editor]:w-full": isReadOnly,
                },
            )}
        >
            <EditorProvider
                className="!border-none"
                codeOnly
                showToolbar={false}
                enableTokens={false}
                id={editorIdRef.current}
            >
                <SharedEditor
                    initialValue={toolString}
                    editorProps={{
                        codeOnly: true,
                        noProvider: true,
                        validationSchema: TOOL_SCHEMA,
                    }}
                    handleChange={(e) => {
                        if (isReadOnly) return
                        setToolString(e)
                    }}
                    editorType="border"
                    className={clsx([
                        "mt-2",
                        {
                            "[&_.agenta-editor-wrapper]:h-[calc(8px+calc(3*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0":
                                minimized,
                            "[&_.agenta-editor-wrapper]:h-fit": !minimized,
                        },
                    ])}
                    state={isReadOnly ? "readOnly" : "filled"}
                    header={
                        <div className={clsx("w-full flex items-center justify-between", "py-1")}>
                            <div className="grow">
                                <div className="flex flex-col gap-1">
                                    <Tooltip
                                        trigger={["hover", "focus"]}
                                        title={
                                            !parsed
                                                ? "Function name can't be edited while json is invalid"
                                                : "Function Name"
                                        }
                                        placement="topLeft"
                                    >
                                        <Input
                                            value={functionName}
                                            variant="borderless"
                                            placeholder="Function Name"
                                            disabled={isReadOnly || !parsed}
                                            // onChange={handleNameChange}
                                            onChange={(e) => {
                                                if (isReadOnly) return
                                                setFunctionName(e.target.value)
                                            }}
                                        />
                                    </Tooltip>
                                    <Tooltip
                                        trigger={["hover", "focus"]}
                                        title={
                                            !parsed
                                                ? "Function description can't be edited while json is invalid"
                                                : "Function Description"
                                        }
                                        placement="topLeft"
                                    >
                                        <Input
                                            value={functionDescription}
                                            variant="borderless"
                                            placeholder="Function Description"
                                            disabled={isReadOnly || !parsed}
                                            // onChange={handleDescriptionChange}
                                            onChange={(e) => {
                                                if (isReadOnly) return
                                                setFunctionDescription(e.target.value)
                                            }}
                                        />
                                    </Tooltip>
                                </div>
                            </div>

                            <PromptMessageContentOptions
                                id={editorIdRef.current}
                                className="invisible group-hover/item:visible"
                                isMessageDeletable={!isReadOnly}
                                disabled={isReadOnly}
                                minimized={minimized}
                                actions={
                                    isReadOnly
                                        ? undefined
                                        : {
                                              deleteMessage,
                                              minimize: () => {
                                                  setMinimized((current) => !current)
                                              },
                                          }
                                }
                                hideMarkdownToggle={true}
                            />
                        </div>
                    }
                />
            </EditorProvider>
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default PlaygroundTool
