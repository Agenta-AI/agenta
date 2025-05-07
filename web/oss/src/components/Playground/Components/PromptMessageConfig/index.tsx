import {useMemo, useCallback, useState, useEffect} from "react"

import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import JSON5 from "json5"
import {$getRoot} from "lexical"
import dynamic from "next/dynamic"

import {useLexicalComposerContext, EditorProvider} from "@/oss/components/Editor/Editor"
import {ON_CHANGE_LANGUAGE} from "@/oss/components/Editor/plugins/code"
import {$isCodeBlockNode} from "@/oss/components/Editor/plugins/code/nodes/CodeBlockNode"
import {tryParsePartialJson} from "@/oss/components/Editor/plugins/code/tryParsePartialJson"
import {getMetadataLazy, getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import {
    Enhanced,
    EnhancedObjectConfig,
} from "../../../../lib/shared/variant/genericTransformer/types"
import {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
import {componentLogger} from "../../assets/utilities/componentLogger"
import usePlayground from "../../hooks/usePlayground"
import {findPropertyInObject, findVariantById} from "../../hooks/usePlayground/assets/helpers"
import {constructChatHistory} from "../../hooks/usePlayground/assets/messageHelpers"
import {findPropertyById} from "../../hooks/usePlayground/middlewares/playgroundVariantMiddleware"
import {PlaygroundStateData} from "../../hooks/usePlayground/types"
import {TooltipWithCopyAction} from "../PlaygroundGenerations/assets/GenerationCompletionRow"
import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import SharedEditor from "../SharedEditor"

import type {PromptMessageConfigProps} from "./types"

const PromptMessageContentOptions = dynamic(
    () =>
        import(
            "../PlaygroundVariantPropertyControl/assets/PromptMessageContent/assets/PromptMessageContentOptions"
        ),
    {ssr: false},
)

/**
 * PromptMessageConfig Component
 *
 * Renders a configuration interface for a single prompt message, including:
 * - Role selector (user/assistant/system)
 * - Content editor for the message
 *
 * The component uses PlaygroundVariantPropertyControl for both role and content
 * editing, configuring them with appropriate controls based on the schema.
 *
 * @param props - {@link PromptMessageConfigProps}
 * @param props.variantId - Unique identifier for the variant being configured
 */
const PromptMessageConfig = ({
    isFunction,
    variantId,
    messageId,
    className,
    rowId,
    deleteMessage,
    rerunMessage,
    isMessageDeletable,
    disabled,
    debug,
    editorClassName,
    placeholder,
    handleChange: propsHandleChange,
    initialValue: propsInitialValue,
    runnable,
    headerClassName,
    footerClassName,
    editorProps,
    isJSON,
    ...props
}: PromptMessageConfigProps) => {
    const [_messageId, _setMessageId] = useState("")
    const [minimized, setMinimized] = useState(false)
    const {message} = usePlayground({
        variantId,
        hookId: "PromptMessageConfig",
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                if (!rowId) {
                    const variant = findVariantById(state, variantId)
                    if (!variant) return {message: undefined}

                    for (const prompt of variant.prompts || []) {
                        const message = prompt.messages?.value.find((msg) => msg.__id === messageId)
                        if (message) {
                            return {
                                message: {
                                    role: message.role.__id,
                                    content: message.content.__id,
                                    name: message.name?.__id,
                                    toolCalls: message.toolCalls?.__id,
                                    toolCallId: message.toolCallId?.__id,
                                },
                            }
                        }
                    }
                    return {message: undefined}
                } else {
                    const object =
                        state.generationData.inputs.value.find((v) => v.__id === rowId) ||
                        state.generationData.messages.value.find((v) => v.__id === rowId)

                    let message = findPropertyInObject(object, messageId)

                    message = message?.value || message

                    if (!message) return {message: undefined}
                    return {
                        message: {
                            role: message.role.__id,
                            content: message.content.__id,
                            toolCalls: message.toolCalls?.__id,
                            name: message.name?.__id,
                            toolCallId: message.toolCallId?.__id,
                        },
                    }
                }
            },
            [messageId, rowId, variantId],
        ),
    })

    const {
        mutate,
        handleParamUpdate: updateVariantProperty,
        baseProperty,
        isTool,
        messageRow,
    } = usePlayground({
        hookId: "PlaygroundVariantPropertyControl",
        stateSelector: (state) => {
            const object = rowId
                ? state.generationData.inputs.value.find((v) => v.__id === rowId) ||
                  (state.generationData.messages.value || []).find((v) => v.__id === rowId)
                : variantId
                  ? state.variants.find((v) => v.id === variantId)
                  : null

            const messageRow = state.generationData.messages.value.find(
                (messageId) => messageId.__id === rowId,
            )

            if (!object) {
                return {}
            } else {
                const toolCalls =
                    findPropertyById(object as EnhancedVariant, message?.toolCalls) ||
                    findPropertyInObject(state, message?.toolCalls)

                const isTool = !!toolCalls?.value && toolCalls.value.length > 0

                const property = rowId
                    ? (findPropertyInObject(
                          object,
                          isTool ? toolCalls.value[0].__id : message?.content,
                      ) as EnhancedObjectConfig<any>)
                    : (findPropertyById(
                          object as EnhancedVariant,
                          isTool ? toolCalls.value[0].__id : message?.content,
                      ) as EnhancedObjectConfig<any>)

                return {baseProperty: property, isTool, messageRow}
            }
        },
    })

    const property = useMemo(() => {
        if (!baseProperty) return null

        const {__metadata, value} = baseProperty

        const handler = isTool
            ? (e: any) => {
                  mutate((clonedState) => {
                      const message = findPropertyById(
                          clonedState.variants.find((v) => v.id === variantId) as EnhancedVariant,
                          baseProperty.__id,
                      )
                      if (!message) return clonedState
                      try {
                          const obj = typeof e === "string" ? JSON.parse(e) : e
                      } catch (error) {
                          const obj = tryParsePartialJson(e)
                      }
                  })
              }
            : rowId
              ? (e: any) => {
                    mutate(
                        (clonedState) => {
                            if (!clonedState) return clonedState
                            const val =
                                e !== null && e !== undefined
                                    ? typeof e === "object" && "target" in e
                                        ? e.target.value
                                        : e
                                    : null

                            const generationData = structuredClone(clonedState.generationData)
                            const object =
                                generationData.inputs.value.find((v) => v.__id === rowId) ||
                                generationData.messages.value.find((v) => v.__id === rowId)

                            if (!object) {
                                return clonedState
                            }

                            const property = findPropertyInObject(
                                object,
                                message?.content,
                            ) as Enhanced<any>

                            if (!property) return clonedState

                            property.value = val

                            clonedState.generationData = generationData

                            return clonedState
                        },
                        {
                            revalidate: false,
                        },
                    )
                }
              : (newValue: any) => {
                    updateVariantProperty?.(newValue, baseProperty.__id, variantId)
                }

        return {
            __metadata: getMetadataLazy(__metadata),
            value: isTool ? baseProperty : value,
            handleChange: handler,
        }
    }, [isTool, baseProperty, mutate, message?.content, rowId, updateVariantProperty, variantId])

    const {__metadata: metadata, value, handleChange} = property || {}

    const _value = useMemo(() => {
        if (isFunction) {
            return propsInitialValue || value
        } else if (isTool) {
            let _val = propsInitialValue || value
            let args = _val?.function?.arguments
            if (typeof args === "string") {
                args = JSON5.parse(args)
                _val = args
            }
            return JSON5.stringify(_val, null, 2)
        } else {
            return propsInitialValue || value
        }
    }, [propsInitialValue, value, isFunction, isTool])

    // Try to access the Lexical editor instance from context
    // This will work if this component is a child of LexicalComposer
    const [editor] = useLexicalComposerContext()
    const [language, setLanguage] = useState("json")
    useEffect(() => {
        return mergeRegister(
            editor.registerUpdateListener(({editorState}) => {
                editorState.read(() => {
                    const root = $getRoot()
                    const codeBlock = root.getChildren().find($isCodeBlockNode)
                    if (codeBlock) {
                        const language = codeBlock.getLanguage()
                        setLanguage((currentLanguage) => {
                            if (currentLanguage === language) return currentLanguage
                            return language
                        })
                    }
                })
            }),
        )
    }, [editor])

    // Function to execute a command on the Lexical editor
    const executeEditorCommand = useCallback(
        (newLanguage: "json" | "yaml") => {
            if (editor) {
                editor.dispatchCommand(ON_CHANGE_LANGUAGE, {
                    language: newLanguage,
                })
            } else {
                // Fallback: Try using the global window registry
                if (typeof window !== "undefined") {
                    // @ts-ignore - Accessing custom property
                    const globalEditor = window._lexicalEditor
                    if (globalEditor) {
                        globalEditor.dispatchCommand(ON_CHANGE_LANGUAGE, {
                            language: "yaml",
                        })
                    } else {
                        console.log("Could not find editor instance through any approach")
                    }
                }
            }
        },
        [editor],
    )

    const _resultHashes = useMemo(() => {
        if (!messageRow?.history?.value) return []

        if (_messageId) {
            const chatHistory = constructChatHistory({
                messageRow,
                messageId: _messageId,
                variantId,
                includeResults: true,
            })

            return chatHistory?.map((history: any) => history?.result).filter(Boolean) || []
        }

        const results =
            messageRow?.history.value
                .map((history) => history.__runs?.[variantId]?.__result)
                .filter(Boolean) || []

        return results
    }, [_messageId])

    const onClickTestsetDrawer = useCallback(() => {
        _setMessageId(messageId)
    }, [messageId])
    const toolInfo = useMemo(() => {
        if (!message || !isTool) return null
        const _value = propsInitialValue || value
        const parsed = typeof _value === "string" ? JSON5.parse(_value) : _value
        return parsed
    }, [propsInitialValue, message, value, isTool])

    const _placeholder = useMemo(() => {
        return isFunction ? "Enter function output" : placeholder
    }, [isFunction, placeholder])

    if (!property) {
        return null
    }

    if (!message) {
        return null
    }

    componentLogger("PromptMessageConfig", variantId, messageId, message)
    return (
        <SharedEditor
            header={
                isFunction ? (
                    <div
                        className={clsx("w-full flex flex-col items-center gap-1", headerClassName)}
                    >
                        <div className={clsx("w-full flex items-center justify-between")}>
                            <PlaygroundVariantPropertyControl
                                propertyId={message.role}
                                variantId={variantId}
                                rowId={rowId}
                                as="SimpleDropdownSelect"
                                className="message-user-select"
                                disabled={disabled}
                            />
                            {!disabled && (
                                <PromptMessageContentOptions
                                    className="invisible group-hover/item:visible"
                                    propertyId={message.content}
                                    variantId={variantId}
                                    messageId={messageId}
                                    isMessageDeletable={isMessageDeletable}
                                    disabled={disabled}
                                    runnable={runnable}
                                    minimized={minimized}
                                    actions={{
                                        deleteMessage,
                                        rerunMessage,
                                        minimize: () => {
                                            setMinimized((current) => !current)
                                        },
                                    }}
                                />
                            )}
                        </div>
                        <div className="w-full pb-2 pt-0 flex items-center justify-between">
                            <PlaygroundVariantPropertyControl
                                propertyId={message.name}
                                variantId={variantId}
                                rowId={rowId}
                                as="SimpleInput"
                                className="message-user-select px-0"
                                disabled={disabled}
                                placeholder="Function name"
                                editorProps={{
                                    variant: "borderless",
                                }}
                            />
                            <PlaygroundVariantPropertyControl
                                propertyId={message.toolCallId}
                                variantId={variantId}
                                rowId={rowId}
                                as="SimpleInput"
                                className="message-user-select px-0 text-right"
                                disabled={disabled}
                                placeholder="Tool call id"
                                editorProps={{
                                    variant: "borderless",
                                }}
                            />
                            {/* test
                            {message.name} */}
                            {/* <Input variant="borderless" placeholder="Function name" /> */}
                            {/* <Input variant="borderless" placeholder="Call Id" value={""} /> */}
                            {/* <TooltipWithCopyAction title={"Call id"}>
                                <span>{value?.id}</span>
                            </TooltipWithCopyAction> */}
                        </div>
                    </div>
                ) : isTool ? (
                    <div
                        className={clsx(
                            "pt-2 w-full flex flex-col items-center gap-1",
                            headerClassName,
                        )}
                    >
                        <div className={clsx("w-full flex items-center justify-between")}>
                            <PlaygroundVariantPropertyControl
                                propertyId={message.role}
                                variantId={variantId}
                                rowId={rowId}
                                as="SimpleDropdownSelect"
                                className="message-user-select"
                                disabled={disabled}
                                runnable={runnable}
                                resultHashes={_resultHashes}
                                actions={{
                                    deleteMessage,
                                    rerunMessage,
                                    onClickTestsetDrawer,
                                }}
                            ></PlaygroundVariantPropertyControl>
                            {!disabled && (
                                <PromptMessageContentOptions
                                    className="invisible group-hover/item:visible"
                                    propertyId={message.content}
                                    variantId={variantId}
                                    messageId={messageId}
                                    isMessageDeletable={isMessageDeletable}
                                    disabled={disabled}
                                    runnable={runnable}
                                    minimized={minimized}
                                    actions={{
                                        deleteMessage,
                                        rerunMessage,
                                        minimize: () => {
                                            setMinimized((current) => !current)
                                        },
                                    }}
                                >
                                    {/* <Select
                                        variant="borderless"
                                        options={[
                                            {value: "json", label: "JSON"},
                                            {value: "yaml", label: "YAML"},
                                        ]}
                                        value={language}
                                        popupMatchSelectWidth={false}
                                        size="small"
                                        onChange={executeEditorCommand}
                                    /> */}
                                </PromptMessageContentOptions>
                            )}
                        </div>
                        <div className="w-full p-2 pt-0 flex items-center justify-between">
                            <TooltipWithCopyAction title={"Function name"}>
                                <span>{toolInfo?.function?.name}</span>
                            </TooltipWithCopyAction>
                            <TooltipWithCopyAction title={"Call id"}>
                                <span>{value?.id}</span>
                            </TooltipWithCopyAction>
                        </div>
                    </div>
                ) : (
                    <div
                        className={clsx(
                            "w-full flex items-center justify-between",
                            headerClassName,
                        )}
                    >
                        <PlaygroundVariantPropertyControl
                            propertyId={message.role}
                            variantId={variantId}
                            rowId={rowId}
                            as="SimpleDropdownSelect"
                            className="message-user-select"
                            disabled={disabled}
                        />

                        {!disabled && (
                            <PromptMessageContentOptions
                                className="invisible group-hover/item:visible"
                                propertyId={message.content}
                                variantId={variantId}
                                messageId={messageId}
                                isMessageDeletable={isMessageDeletable}
                                disabled={disabled}
                                runnable={runnable}
                                resultHashes={_resultHashes}
                                actions={{
                                    deleteMessage,
                                    rerunMessage,
                                    onClickTestsetDrawer,
                                    minimize: () => {
                                        setMinimized((current) => !current)
                                    },
                                }}
                            />
                        )}
                    </div>
                )
            }
            key={`${isTool}-${messageId}`}
            handleChange={propsHandleChange || handleChange}
            initialValue={_value}
            editorClassName={editorClassName}
            placeholder={_placeholder || metadata?.description}
            disabled={disabled}
            className={clsx([
                "mt-2",
                {
                    "[&_.agenta-editor-wrapper]:h-[calc(8px+calc(3*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0":
                        minimized,
                    "[&_.agenta-editor-wrapper]:h-fit": !minimized,
                },
                className,
            ])}
            editorProps={{
                ...(editorProps || {}),
                codeOnly: isJSON || isTool,
                noProvider: true,
                enableTokens: !(isJSON || isTool),
                showToolbar: false,
            }}
            {...props}
        />
    )
}

const checkIsJSON = (_value) => {
    if (!_value) return false
    try {
        if (typeof _value === "string") {
            const json = JSON5.parse(_value)
            return typeof json === "object" && Object.keys(json).length > 0
        } else {
            return true
        }
    } catch (e) {
        return false
    }
}

const PromptMessageConfigWrapper = (props: PromptMessageConfigProps) => {
    const {message, messages, isFunction, isJSON} = usePlayground({
        variantId: props.variantId,
        hookId: "PromptMessageConfig",
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                if (!props.rowId) {
                    const variant = findVariantById(state, props.variantId)
                    if (!variant) return {message: undefined}

                    for (const prompt of variant.prompts || []) {
                        const message = prompt.messages?.value.find(
                            (msg) => msg.__id === props.messageId,
                        )
                        if (message) {
                            return {
                                message: {
                                    role: message.role.__id,
                                    content: message.content.__id,
                                    name: message.name?.__id,
                                    toolCalls: message.toolCalls?.__id,
                                },
                                isJSON: checkIsJSON(message.content?.value),
                            }
                        }
                    }
                    return {message: undefined, isJSON: false}
                } else {
                    const object =
                        state.generationData.inputs.value.find((v) => v.__id === props.rowId) ||
                        state.generationData.messages.value.find((v) => v.__id === props.rowId)

                    let message = findPropertyInObject(object, props.messageId)

                    message = message?.value || message

                    if (!message) return {message: undefined, isJSON: false}

                    if (!message.role) {
                        const messagesResponse = getResponseLazy(message?.__result)?.response
                        if (messagesResponse) {
                            return {
                                messages: messagesResponse,
                                isJSON: checkIsJSON(message.content?.value),
                            }
                        }
                    }
                    return message.role && message.content
                        ? {
                              message: {
                                  role: message.role?.__id,
                                  content: message.content?.__id,
                                  toolCalls: message.toolCalls?.__id,
                                  toolCallId: message.toolCallId?.__id,
                                  name: message.name?.__id,
                              },
                              isJSON: checkIsJSON(message.content?.value),
                              isFunction: message.role?.value === "tool",
                          }
                        : {
                              messages: undefined,
                              isJSON: false,
                          }
                }
            },
            [props.messageId, props.rowId, props.variantId],
        ),
    })

    const {isTool} = usePlayground({
        hookId: "PlaygroundVariantPropertyControl",
        stateSelector: (state) => {
            const object = props.rowId
                ? state.generationData.inputs.value.find((v) => v.__id === props.rowId) ||
                  (state.generationData.messages.value || []).find((v) => v.__id === props.rowId)
                : props.variantId
                  ? state.variants.find((v) => v.id === props.variantId)
                  : null

            if (!object) {
                return {}
            } else {
                const toolCalls =
                    findPropertyById(object as EnhancedVariant, message?.toolCalls) ||
                    findPropertyInObject(state, message?.toolCalls)

                const isTool = !!toolCalls?.value && toolCalls.value.length > 0

                return {isTool}
            }
        },
    })

    return (
        <div className="w-full relative">
            <EditorProvider
                codeOnly={isTool || isJSON}
                enableTokens={!(isTool || isJSON)}
                showToolbar={false}
            >
                <PromptMessageConfig
                    isJSON={isJSON}
                    isFunction={isFunction}
                    isTool={isTool}
                    {...props}
                />
            </EditorProvider>
        </div>
    )
}
export default PromptMessageConfigWrapper
