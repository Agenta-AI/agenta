import {useMemo, useCallback, useState, useEffect} from "react"

import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import JSON5 from "json5"
import {$getRoot} from "lexical"
import dynamic from "next/dynamic"

import {useLexicalComposerContext, EditorProvider} from "@/oss/components/Editor/Editor"
import {$isCodeBlockNode} from "@/oss/components/Editor/plugins/code/nodes/CodeBlockNode"
import {tryParsePartialJson} from "@/oss/components/Editor/plugins/code/tryParsePartialJson"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {getMetadataLazy, getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {createObjectFromMetadata} from "@/oss/lib/shared/variant/genericTransformer/helpers/arrays"
import {ChatRole} from "@/oss/lib/Types"

import {
    Enhanced,
    EnhancedObjectConfig,
} from "../../../../lib/shared/variant/genericTransformer/types"
import {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
import usePlayground from "../../hooks/usePlayground"
import {findPropertyInObject, findVariantById} from "../../hooks/usePlayground/assets/helpers"
import {findPropertyById} from "../../hooks/usePlayground/middlewares/playgroundVariantMiddleware"
import {PlaygroundStateData} from "../../hooks/usePlayground/types"
import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import PromptImageUpload from "../PlaygroundVariantPropertyControl/assets/PromptImageUpload"
import SharedEditor from "../SharedEditor"

import type {PromptMessageConfigProps} from "./types"
import {getEnhancedProperties} from "@/oss/lib/shared/variant"

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
    allowFileUpload = false,
    message: messageProp,
    ...props
}: PromptMessageConfigProps) => {
    // Allow null to represent an empty upload slot
    // const [uploadedFileItems, setUploadedFileItems] = useState<(UploadFile | null)[]>([])
    const [minimized, setMinimized] = useState(false)

    const {isChat} = usePlayground({
        stateSelector: (state) => ({
            isChat: state.variants.some((v) => v.isChat),
        }),
    })

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
                                messageFull: message,
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

                    // only access content after confirming message exists
                    let contentTarget = message.content
                    return {
                        message: {
                            role: message.role.__id,
                            content: contentTarget.__id,
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
        baseImageProperties,
        messageRow,
        baseContentProperty,
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

                let baseContentProperty = null
                let textProperty = null
                let baseImageProperties = null
                let property = rowId
                    ? (findPropertyInObject(
                          object,
                          isTool ? toolCalls.value[0].__id : message?.content,
                      ) as EnhancedObjectConfig<any>)
                    : (findPropertyById(
                          object as EnhancedVariant,
                          isTool ? toolCalls.value[0].__id : message?.content,
                      ) as EnhancedObjectConfig<any>)

                baseContentProperty = property
                if (Array.isArray(property?.value)) {
                    textProperty = property.value.find((v) => !!v && "text" in v)?.text
                    baseImageProperties = property.value
                        .map((v) => (!!v && "imageUrl" in v ? v.imageUrl?.url : undefined))
                        .filter(Boolean)
                    property = textProperty || baseImageProperties
                }
                return {
                    baseProperty: property,
                    isTool,
                    messageRow,
                    textProperty,
                    baseImageProperties,
                    baseContentProperty,
                }
            }
        },
    })

    const {variables} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const variant = findVariantById(state, variantId)
                const inputKeyValues = variant?.prompts.map((p) => p.inputKeys.value)
                const variables = inputKeyValues?.flatMap((key) => key.map((k) => k.value))

                return {variables}
            },
            [variantId],
        ),
    })

    const getProperty = useCallback(
        (property: any) => {
            if (!property) return null

            const {__metadata, value} = property

            const handler = isTool
                ? (e: any) => {
                      mutate((clonedState) => {
                          const message = findPropertyById(
                              clonedState.variants.find(
                                  (v) => v.id === variantId,
                              ) as EnhancedVariant,
                              property.__id,
                          )
                          if (!message) return clonedState
                          try {
                              const _obj = typeof e === "string" ? JSON.parse(e) : e
                          } catch (error) {
                              const _obj = tryParsePartialJson(e)
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

                                const _property = findPropertyInObject(
                                    object,
                                    property.__id,
                                ) as Enhanced<any>

                                if (!_property) return clonedState

                                _property.value = val

                                clonedState.generationData = generationData

                                return clonedState
                            },
                            {
                                revalidate: false,
                            },
                        )
                    }
                  : (newValue: any) => {
                        updateVariantProperty?.(newValue, property.__id, variantId)
                    }

            return {
                __metadata: getMetadataLazy(__metadata),
                __id: property.__id,
                value: isTool ? property : value,
                handleChange: handler,
            }
        },
        [isTool, mutate, rowId, updateVariantProperty, variantId],
    )

    const property = useMemo(() => {
        return getProperty(baseProperty)
    }, [baseProperty, getProperty])

    const imageProperties = useMemo(() => {
        return baseImageProperties?.map(getProperty)
    }, [baseImageProperties, getProperty])

    const contentProperty = useMemo(() => {
        return getProperty(baseContentProperty)
    }, [baseContentProperty, getProperty])

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
            const x = value
            if (Array.isArray(x)) {
                const textNode = x.filter((part) => "text" in part)
                return textNode.map((part) => part.text).join("")
            } else {
                return x || ""
            }
        }
    }, [propsInitialValue, value, isFunction, isTool])

    const handleAddUploadSlot = useCallback(() => {
        const imageNodes = Array.isArray(contentProperty?.value)
            ? contentProperty.value.filter((part) => "imageUrl" in part)
            : []
        if (imageNodes?.length >= 5) return

        const itemMetadata = getMetadataLazy(
            contentProperty?.__metadata,
        )?.itemMetadata?.options?.find((part) => "imageUrl" in part.properties)
        const imageNode = createObjectFromMetadata(itemMetadata)
        imageNode.type.value = "image_url"

        const newValue = [...contentProperty?.value, imageNode]
        contentProperty?.handleChange(newValue)
    }, [contentProperty])

    const handleRemoveFileItem = useCallback(
        (propertyId: string) => {
            if (!contentProperty) return
            const cloned = structuredClone(contentProperty.value)
            const index = cloned.findIndex((part) => {
                const found = findPropertyInObject(part, propertyId)
                return !!found
            })
            if (index >= 0) {
                // remove item at index
                const x = cloned.splice(index, 1)
                contentProperty.handleChange(cloned)
            }
        },
        [contentProperty],
    )

    // Try to access the Lexical editor instance from context
    // This will work if this component is a child of LexicalComposer
    const [editor] = useLexicalComposerContext()
    const [_language, _setLanguage] = useState("json")
    useEffect(() => {
        const unregister = mergeRegister(
            editor.registerUpdateListener(({editorState}) => {
                editorState.read(() => {
                    const root = $getRoot()
                    const codeBlock = root.getChildren().find($isCodeBlockNode)
                    if (codeBlock) {
                        const language = codeBlock.getLanguage()
                        _setLanguage((currentLanguage) => {
                            if (currentLanguage === language) return currentLanguage
                            return language
                        })
                    }
                })
            }),
        )
        return unregister
    }, [editor])

    const _resultHashes = useMemo(() => {
        if (!messageRow?.history?.value) return []

        const results: string[] = []

        if (messageId) {
            const historyItem = messageRow.history.value.find((h) => h.__id === messageId)

            if (historyItem) {
                Object.values(historyItem.__runs || {}).forEach((run) => {
                    // Only include results from runs associated with the selected messageId
                    if (run?.__result && run.messageId === messageId) results.push(run.__result)
                })
            } else {
                for (const history of messageRow.history.value) {
                    for (const run of Object.values(history.__runs || {})) {
                        if (run?.message?.__id === messageId) {
                            if (run.__result) results.push(run.__result)
                        }

                        if (
                            Array.isArray(run?.messages) &&
                            run.messages.some((m) => m.__id === messageId)
                        ) {
                            if (run.__result) results.push(run.__result)
                        }
                    }
                }
            }
        } else {
            messageRow.history.value.forEach((history) => {
                const result = history.__runs?.[variantId]?.__result
                if (result) results.push(result)
            })
        }

        return results
    }, [messageId, messageRow, variantId])

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
                                        handleAddUploadSlot,
                                    }}
                                    allowFileUpload={allowFileUpload}
                                    uploadCount={imageProperties?.length}
                                    hideMarkdownToggle={true}
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
                                        handleAddUploadSlot,
                                    }}
                                    allowFileUpload={allowFileUpload}
                                    uploadCount={imageProperties?.length || 0}
                                    hideMarkdownToggle={true}
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
                                <span>{value?.__id}</span>
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
                        {message.role ? (
                            <PlaygroundVariantPropertyControl
                                propertyId={message.role}
                                variantId={variantId}
                                rowId={rowId}
                                as="SimpleDropdownSelect"
                                className="message-user-select"
                                disabled={disabled}
                            />
                        ) : null}

                        {!disabled && (
                            <PromptMessageContentOptions
                                className="invisible group-hover/item:visible"
                                propertyId={message.content}
                                variantId={variantId}
                                messageId={messageId}
                                isMessageDeletable={isMessageDeletable}
                                disabled={disabled}
                                minimized={minimized}
                                runnable={runnable}
                                resultHashes={_resultHashes}
                                actions={{
                                    deleteMessage,
                                    rerunMessage,
                                    minimize: () => {
                                        setMinimized((current) => !current)
                                    },
                                    handleAddUploadSlot,
                                }}
                                allowFileUpload={
                                    allowFileUpload && messageProp?.role.value === ChatRole.User
                                }
                                uploadCount={imageProperties?.length}
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
                codeOnly: isJSON || isTool,
                noProvider: true,
                enableTokens: !(isJSON || isTool),
                tokens: variables,
                showToolbar: false,
                ...(editorProps || {}),
            }}
            {...props}
            footer={
                <div className="w-full">
                    <div className="flex flex-col my-2 items-center gap-2">
                        {isChat && imageProperties?.length > 0
                            ? imageProperties.map((property, idx) => (
                                  <PromptImageUpload
                                      key={property.__id}
                                      disabled={disabled}
                                      imageFile={
                                          property?.value
                                              ? {
                                                    status: "done",
                                                    thumbUrl: property.value,
                                                }
                                              : undefined
                                      }
                                      handleUploadFileChange={(newFile) => {
                                          const imagePart =
                                              newFile?.base64 ||
                                              newFile?.url ||
                                              newFile?.thumbUrl ||
                                              ""

                                          if (property) {
                                              property.handleChange(imagePart)
                                          }
                                      }}
                                      handleRemoveUploadFile={() => {
                                          handleRemoveFileItem(property.__id)
                                      }}
                                  />
                              ))
                            : null}
                    </div>

                    {props.footer}
                </div>
            }
        />
    )
}

const checkIsJSON = (_value: any) => {
    if (!_value || _value === "{}" || _value === "[]") return false // Special case for empty object
    if (typeof _value === "string") {
        try {
            const parsed = JSON5.parse(_value)
            return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        } catch {
            return false
        }
    }

    return false
}

const PromptMessageConfigWrapper = (props: PromptMessageConfigProps) => {
    const {message, isFunction, isJSON} = usePlayground({
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
