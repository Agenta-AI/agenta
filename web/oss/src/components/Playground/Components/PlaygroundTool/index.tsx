import {useCallback, useEffect, useMemo, useState} from "react"

import {Input, Tooltip} from "antd"
import clsx from "clsx"
import JSON5 from "json5"

import {EditorProvider} from "@/oss/components/Editor/Editor"

import usePlayground from "../../hooks/usePlayground"
import {
    findParentOfPropertyInObject,
    findVariantById,
} from "../../hooks/usePlayground/assets/helpers"
import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControl/assets/PlaygroundVariantPropertyControlWrapper"
import PromptMessageContentOptions from "../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"
import SharedEditor from "../SharedEditor"

import {TOOL_SCHEMA} from "./assets"

const PlaygroundTool = ({value, disabled, variantId, baseProperty, ...editorProps}) => {
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
        if (!toolString) {
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
    }, [functionName])

    useEffect(() => {
        if (!toolString) {
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
    }, [functionDescription])

    useEffect(() => {
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
    }, [toolString])

    const {mutate} = usePlayground()
    const deleteMessage = useCallback(() => {
        mutate((draftState) => {
            const variant = findVariantById(draftState, variantId)

            const x = findParentOfPropertyInObject(variant, baseProperty.__id)
            if (x) {
                x.value = x.value.filter((v) => v.__id !== baseProperty.__id)
            }

            return draftState
        })
    }, [variantId, baseProperty.id])

    return (
        <PlaygroundVariantPropertyControlWrapper className="w-full max-w-full overflow-y-auto flex [&_>_div]:!w-auto [&_>_div]:!grow !my-0">
            <EditorProvider
                className="!border-none"
                codeOnly
                showToolbar={false}
                enableTokens={false}
            >
                <SharedEditor
                    initialValue={toolString}
                    editorProps={{
                        codeOnly: true,
                        noProvider: true,
                        validationSchema: TOOL_SCHEMA,
                    }}
                    handleChange={(e) => {
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
                    state="filled"
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
                                            disabled={!parsed}
                                            // onChange={handleNameChange}
                                            onChange={(e) => {
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
                                            disabled={!parsed}
                                            // onChange={handleDescriptionChange}
                                            onChange={(e) => {
                                                setFunctionDescription(e.target.value)
                                            }}
                                        />
                                    </Tooltip>
                                </div>
                            </div>

                            <PromptMessageContentOptions
                                className="invisible group-hover/item:visible"
                                isMessageDeletable={false}
                                disabled={false}
                                minimized={minimized}
                                actions={{
                                    deleteMessage,
                                    minimize: () => {
                                        setMinimized((current) => !current)
                                    },
                                }}
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
