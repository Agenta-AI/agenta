import {useCallback, useMemo} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import usePlayground from "../../hooks/usePlayground"
import {componentLogger} from "../../assets/utilities/componentLogger"

import type {PromptMessageConfigProps} from "./types"
import {PlaygroundStateData} from "../../hooks/usePlayground/types"
import {findPropertyInObject, findVariantById} from "../../hooks/usePlayground/assets/helpers"
import SharedEditor from "../SharedEditor"
import {Enhanced, EnhancedObjectConfig} from "../../assets/utilities/genericTransformer/types"
import {findPropertyById} from "../../hooks/usePlayground/middlewares/playgroundVariantMiddleware"
import {EnhancedVariant} from "../../assets/utilities/transformer/types"
import {getMetadataLazy} from "../../state"
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
    } = usePlayground({
        hookId: "PlaygroundVariantPropertyControl",
        stateSelector: (state) => {
            const object = !!rowId
                ? state.generationData.inputs.value.find((v) => v.__id === rowId) ||
                  (state.generationData.messages.value || []).find((v) => v.__id === rowId)
                : variantId
                  ? state.variants.find((v) => v.id === variantId)
                  : null

            if (!object) {
                return {}
            } else {
                const property = !!rowId
                    ? (findPropertyInObject(object, message?.content) as EnhancedObjectConfig<any>)
                    : (findPropertyById(
                          object as EnhancedVariant,
                          message?.content,
                      ) as EnhancedObjectConfig<any>)
                return {baseProperty: property}
            }
        },
    })

    const property = useMemo(() => {
        if (!baseProperty) return null

        const {__metadata, value} = baseProperty

        const handler = rowId
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
    }, [baseProperty, mutate, message?.content, rowId, updateVariantProperty, variantId])

    if (!property) {
        return null
    }

    const {__metadata: metadata, value, handleChange} = property

    if (!message) {
        return null
    }

    componentLogger("PromptMessageConfig", variantId, messageId, message)

    return (
        <SharedEditor
            header={
                <div className={clsx("w-full flex items-center justify-between", headerClassName)}>
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
            }
            handleChange={propsHandleChange || handleChange}
            initialValue={propsInitialValue || value}
            editorClassName={editorClassName}
            placeholder={placeholder || metadata?.description}
            disabled={disabled}
            className={className}
            {...props}
        />
    )
}

export default PromptMessageConfig
