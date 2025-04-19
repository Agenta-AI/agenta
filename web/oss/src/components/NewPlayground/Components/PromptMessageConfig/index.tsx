import {useMemo, useCallback, useState, useEffect} from "react"

import {mergeRegister} from "@lexical/utils"
import {Select} from "antd"
import clsx from "clsx"
import isEqual from "fast-deep-equal"
import {$getRoot} from "lexical"
import dynamic from "next/dynamic"

import {useLexicalComposerContext, EditorProvider} from "@/oss/components/Editor/Editor"
import {ON_CHANGE_LANGUAGE} from "@/oss/components/Editor/plugins/code"
import {$isCodeBlockNode} from "@/oss/components/Editor/plugins/code/nodes/CodeBlockNode"
import useResizeObserver from "@/oss/hooks/useResizeObserver"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import {
    Enhanced,
    EnhancedObjectConfig,
} from "../../../../lib/shared/variant/genericTransformer/types"
import {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
import {componentLogger} from "../../assets/utilities/componentLogger"
import usePlayground from "../../hooks/usePlayground"
import {findPropertyInObject, findVariantById} from "../../hooks/usePlayground/assets/helpers"
import {findPropertyById} from "../../hooks/usePlayground/middlewares/playgroundVariantMiddleware"
import {PlaygroundStateData} from "../../hooks/usePlayground/types"
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
    ...props
}: PromptMessageConfigProps) => {
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
    } = usePlayground({
        hookId: "PlaygroundVariantPropertyControl",
        stateSelector: (state) => {
            const object = rowId
                ? state.generationData.inputs.value.find((v) => v.__id === rowId) ||
                  (state.generationData.messages.value || []).find((v) => v.__id === rowId)
                : variantId
                  ? state.variants.find((v) => v.id === variantId)
                  : null

            if (!object) {
                return {}
            } else {
                const role = findPropertyById(object as EnhancedVariant, message?.role)
                const isTool = role?.value === "tool"
                const property = rowId
                    ? (findPropertyInObject(
                          object,
                          isTool ? message?.toolCalls : message?.content,
                      ) as EnhancedObjectConfig<any>)
                    : (findPropertyById(
                          object as EnhancedVariant,
                          isTool ? message?.toolCalls : message?.content,
                      ) as EnhancedObjectConfig<any>)

                return {baseProperty: property, isTool}
            }
        },
    })

    const property = useMemo(() => {
        if (!baseProperty) return null

        const {__metadata, value} = baseProperty

        const handler = isTool
            ? (e: any) => {
                  console.log("tool handler")
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
            value,
            handleChange: handler,
        }
    }, [isTool, baseProperty, mutate, message?.content, rowId, updateVariantProperty, variantId])

    const {__metadata: metadata, value, handleChange} = property || {}

    const _value = useMemo(() => {
        if (isTool) {
            return JSON.stringify((propsInitialValue || value)?.[0], null, 2)
        } else {
            return propsInitialValue || value
        }
    }, [propsInitialValue, value])

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
            console.log("Executing editor command using useLexicalComposerContext", newLanguage)

            if (editor) {
                console.log("Found editor from context, dispatching ON_CHANGE_LANGUAGE command")
                editor.dispatchCommand(ON_CHANGE_LANGUAGE, {
                    language: newLanguage,
                })
            } else {
                console.log(
                    "No editor found in context - this component might not be inside a LexicalComposer",
                )

                // Fallback: Try using the global window registry
                if (typeof window !== "undefined") {
                    // @ts-ignore - Accessing custom property
                    const globalEditor = window._lexicalEditor
                    if (globalEditor) {
                        console.log("Found editor through window global")
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

    if (!property) {
        return null
    }

    if (!message) {
        return null
    }

    componentLogger("PromptMessageConfig", variantId, messageId, message)

    if (isTool) {
        console.log("message role", value, propsInitialValue || value)
    }

    return (
        <SharedEditor
            header={
                isTool ? (
                    <div
                        className={clsx(
                            "w-full flex items-center justify-between",
                            headerClassName,
                        )}
                    >
                        <PlaygroundVariantPropertyControl
                            propertyId={message.name}
                            variantId={variantId}
                            rowId={rowId}
                            disabled={disabled}
                            useAntdInput
                            editorProps={{
                                variant: "borderless",
                            }}
                            placeholder="Enter tool name"
                            as="SimpleInput"
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
                                actions={{
                                    deleteMessage,
                                    rerunMessage,
                                }}
                            >
                                <Select
                                    variant="borderless"
                                    options={[
                                        {value: "json", label: "JSON"},
                                        {value: "yaml", label: "YAML"},
                                    ]}
                                    value={language}
                                    popupMatchSelectWidth={false}
                                    size="small"
                                    onChange={executeEditorCommand}
                                />
                            </PromptMessageContentOptions>
                        )}
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
                                actions={{
                                    deleteMessage,
                                    rerunMessage,
                                }}
                            />
                        )}
                    </div>
                )
            }
            handleChange={propsHandleChange || handleChange}
            initialValue={_value}
            editorClassName={editorClassName}
            placeholder={placeholder || metadata?.description}
            disabled={disabled}
            className={className}
            editorProps={{
                ...(editorProps || {}),
                codeOnly: isTool,
                noProvider: true,
                validationSchema: isTool
                    ? {
                          type: "object",
                          properties: {
                              type: {
                                  type: "string",
                                  const: "function",
                                  title: "Type",
                                  default: "function",
                              },
                              name: {
                                  type: "string",
                                  title: "Name",
                              },
                              description: {
                                  type: "string",
                                  title: "Description",
                              },
                              parameters: {
                                  type: "object",
                                  properties: {
                                      location: {
                                          type: "string",
                                          description: "City and country e.g. Bogotá, Colombia",
                                          title: "Location",
                                      },
                                  },
                                  required: ["location"],
                                  additionalProperties: false,
                                  title: "Parameters",
                              },
                          },
                          required: ["type", "name", "description", "parameters"],
                          additionalProperties: false,
                          title: "Function",
                      }
                    : undefined,
                enableTokens: !isTool,
            }}
            {...props}
        />
    )
}

const PromptMessageConfigWrapper = (props: PromptMessageConfigProps) => {
    const {message} = usePlayground({
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
                            }
                        }
                    }
                    return {message: undefined}
                } else {
                    const object =
                        state.generationData.inputs.value.find((v) => v.__id === props.rowId) ||
                        state.generationData.messages.value.find((v) => v.__id === props.rowId)

                    let message = findPropertyInObject(object, props.messageId)

                    message = message?.value || message

                    if (!message) return {message: undefined}
                    return {
                        message: {
                            role: message.role.__id,
                            content: message.content.__id,
                        },
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
                const role = findPropertyById(object as EnhancedVariant, message?.role)
                const isTool = role?.value === "tool"
                return {isTool}
            }
        },
    })

    return (
        <div className="w-full relative">
            <EditorProvider
                codeOnly={isTool}
                validationSchema={
                    isTool
                        ? {
                              type: "object",
                              properties: {
                                  type: {
                                      type: "string",
                                      const: "function",
                                      title: "Type",
                                      default: "function",
                                  },
                                  name: {
                                      type: "string",
                                      title: "Name",
                                  },
                                  description: {
                                      type: "string",
                                      title: "Description",
                                  },
                                  parameters: {
                                      type: "object",
                                      properties: {
                                          location: {
                                              type: "string",
                                              description: "City and country e.g. Bogotá, Colombia",
                                              title: "Location",
                                          },
                                      },
                                      required: ["location"],
                                      additionalProperties: false,
                                      title: "Parameters",
                                  },
                              },
                              required: ["type", "name", "description", "parameters"],
                              additionalProperties: false,
                              title: "Function",
                          }
                        : undefined
                }
                enableTokens={!isTool}
                showToolbar={false}
            >
                <PromptMessageConfig isTool={isTool} {...props} />
            </EditorProvider>
        </div>
    )
}
export default PromptMessageConfigWrapper
