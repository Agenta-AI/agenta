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
    const [toolString, setToolString] = useState<string | null>(() => {
        try {
            if (!value) {
                return ""
            }
            return typeof value === "string" ? value : JSON5.stringify(value, null, 2)
        } catch (e) {
            return ""
        }
    })
    const [functionName, setFunctionName] = useState(() => {
        try {
            return typeof value === "string"
                ? (JSON5.parse(value)?.function?.name ?? "")
                : (value?.function?.name ?? "")
        } catch (err) {
            return ""
        }
    })
    const [functionDescription, setFunctionDescription] = useState(() => {
        try {
            return typeof value === "string"
                ? (JSON5.parse(value)?.function?.description ?? "")
                : (value?.function?.description ?? "")
        } catch (err) {
            return ""
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

    const syncToolFunctionField = useCallback(
        (updater: (toolFunction: any) => any) => {
            if (isReadOnly) return

            setToolString((currentString) => {
                if (!currentString) return currentString

                try {
                    const parsedTool = JSON5.parse(currentString)
                    const currentFunction = parsedTool.function ?? {}
                    const nextFunction = updater(currentFunction)
                    const isSameReference =
                        (parsedTool.function && nextFunction === parsedTool.function) ||
                        nextFunction === currentFunction
                    const nextFunctionIsObject =
                        typeof nextFunction === "object" && nextFunction !== null
                    const isEmptyNoop =
                        !parsedTool.function &&
                        nextFunction === currentFunction &&
                        (!nextFunctionIsObject || Object.keys(nextFunction).length === 0)

                    if (isSameReference || isEmptyNoop) {
                        return currentString
                    }

                    const updatedTool = {
                        ...parsedTool,
                        function: nextFunction,
                    }

                    const nextString = JSON.stringify(updatedTool, null, 2)
                    return nextString === currentString ? currentString : nextString
                } catch (err) {
                    console.error(err)
                    return currentString
                }
            })
        },
        [isReadOnly],
    )

    useEffect(() => {
        if (isReadOnly) return
        try {
            const parsedTool = JSON5.parse(toolString)
            editorProps?.handleChange?.(parsedTool)
            setFunctionName((currentName) => {
                const nextName = parsedTool?.function?.name ?? ""
                if (currentName !== nextName) {
                    return nextName
                }
                return currentName
            })
            setFunctionDescription((currentDescription) => {
                const nextDescription = parsedTool?.function?.description ?? ""
                if (currentDescription !== nextDescription) {
                    return nextDescription
                }
                return currentDescription
            })
        } catch (e) {
            if (!toolString) {
                setFunctionName("")
                setFunctionDescription("")
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
                    initialValue={toolString ?? ""}
                    editorProps={{
                        codeOnly: true,
                        noProvider: true,
                        validationSchema: TOOL_SCHEMA,
                    }}
                    handleChange={(e) => {
                        if (isReadOnly) return
                        setToolString(e)
                    }}
                    syncWithInitialValueChanges
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
                                            onChange={(e) => {
                                                if (isReadOnly) return

                                                const nextName = e.target.value
                                                setFunctionName(nextName)
                                                syncToolFunctionField((toolFunction) => {
                                                    if (toolFunction?.name === nextName) {
                                                        return toolFunction
                                                    }

                                                    return {
                                                        ...toolFunction,
                                                        name: nextName,
                                                    }
                                                })
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
                                            onChange={(e) => {
                                                if (isReadOnly) return

                                                const nextDescription = e.target.value
                                                setFunctionDescription(nextDescription)
                                                syncToolFunctionField((toolFunction) => {
                                                    if (
                                                        toolFunction?.description ===
                                                        nextDescription
                                                    ) {
                                                        return toolFunction
                                                    }

                                                    return {
                                                        ...toolFunction,
                                                        description: nextDescription,
                                                    }
                                                })
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
