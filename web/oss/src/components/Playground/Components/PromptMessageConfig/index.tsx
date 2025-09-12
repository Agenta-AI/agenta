import {useMemo, useCallback, useState, useEffect} from "react"

import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useSetAtom, useAtomValue} from "jotai"
import JSON5 from "json5"
import {$getRoot} from "lexical"
import dynamic from "next/dynamic"

import {useLexicalComposerContext, EditorProvider} from "@/oss/components/Editor/Editor"
import {$isCodeBlockNode} from "@/oss/components/Editor/plugins/code/nodes/CodeBlockNode"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {createObjectFromMetadata} from "@/oss/lib/shared/variant/genericTransformer/helpers/arrays"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {ChatRole} from "@/oss/lib/Types"
import {chatTurnsByIdAtom, runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"

import {findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"
import {usePromptMessageConfig} from "../../hooks/usePromptMessageConfig"
import {
    updateGenerationDataPropertyMutationAtom,
    promptPropertyAtomFamily,
    updateVariantPropertyEnhancedMutationAtom,
    displayedVariantsAtom,
} from "../../state/atoms"
import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"
import PromptImageUpload from "../PlaygroundVariantPropertyControl/assets/PromptImageUpload"
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
    allowFileUpload = false,
    message: messageProp,
    viewOnly,
    ...props
}: PromptMessageConfigProps) => {
    // Allow null to xrepresent an empty upload slot
    // const [uploadedFileItems, setUploadedFileItems] = useState<(UploadFile | null)[]>([])
    const [minimized, setMinimized] = useState(false)

    // Use optimized hook for chat detection and message data
    const {
        isChat: _isChat,
        message: optimizedMessage,
        variables: optimizedVariables,
    } = usePromptMessageConfig({
        variantId,
        messageId,
        rowId,
    })

    // Prefer live message from generation entities to reflect mutations immediately
    const turnsById = useAtomValue(chatTurnsByIdAtom) as any
    const messageFromTurns = useMemo(() => {
        const turn = rowId ? turnsById?.[rowId] : undefined
        if (!turn) return undefined
        if (messageId?.endsWith("-assistant")) {
            // Assistant message is revision-scoped; try optimized variables for revision if available
            const revId = (optimizedVariables as any)?.selectedRevisionId
            return revId ? turn?.assistantMessageByRevision?.[revId] : undefined
        }
        return turn?.userMessage
    }, [turnsById, rowId, messageId, optimizedVariables])

    // Use the freshest available message
    const message = (messageFromTurns as any) ?? (optimizedMessage as any) ?? (messageProp as any)

    // Get variant data directly from atoms to avoid data contamination
    // const playgroundVariants = useAtomValue(playgroundVariantsAtom)
    // const variant = playgroundVariants?.[variantId || ""]

    // Get optimized mutation functions
    const updateVariantProperty = useSetAtom(updateVariantPropertyEnhancedMutationAtom)
    const updateGenerationDataProperty = useSetAtom(updateGenerationDataPropertyMutationAtom)

    // Facade write setup for content property (prompts-only). Fallback to noop when unavailable.
    const noopWriteAtom = useMemo(() => atom(null, () => {}), [])
    const revisionId = useMemo(() => {
        return variantId && typeof variantId === "object"
            ? (variantId as any).id
            : (variantId as any)
    }, [variantId])

    // content write facade is defined after baseContentProperty to use the correct property id

    // Essential property extraction for message rendering
    // The usePromptMessageConfig hook should provide the message with proper structure
    const baseProperty = useMemo(() => {
        if (!message?.content) return null

        // If content is an array, find the text item and return its text property
        if (Array.isArray(message.content.value)) {
            const textItem = message.content.value.find((item: any) => item?.type?.value === "text")
            return textItem?.text || null
        }

        // For simple string content, return the content property itself
        return message.content
    }, [message?.content]) // Use the message content property
    const isTool = message?.role?.value === "tool" || false

    // Extract image properties from content property
    const baseImageProperties = useMemo(() => {
        const val = message?.content?.value
        const isArr = Array.isArray(val)

        if (!val || !isArr) {
            return []
        }

        const nodes = val
            .map((v) => (!!v && "imageUrl" in v ? v.imageUrl?.url : undefined))
            .filter((node) => node != null)

        return nodes
    }, [message?.content?.value])

    const baseContentProperty = message?.content || null

    const contentPromptWriteAtom = useMemo(() => {
        const contentId = (baseContentProperty as any)?.__id
        if (revisionId && contentId) {
            return promptPropertyAtomFamily({
                revisionId,
                propertyId: contentId,
            })
        }
        return noopWriteAtom
    }, [revisionId, (baseContentProperty as any)?.__id, noopWriteAtom])
    const setContentPromptValue = useSetAtom(contentPromptWriteAtom)

    // Facade write setup for base text property (prompts-only)
    const baseTextPromptWriteAtom = useMemo(() => {
        const textId = (baseProperty as any)?.__id
        if (revisionId && textId) {
            return promptPropertyAtomFamily({
                revisionId,
                propertyId: textId,
            })
        }
        return noopWriteAtom
    }, [revisionId, (baseProperty as any)?.__id, noopWriteAtom])
    const setBaseTextPromptValue = useSetAtom(baseTextPromptWriteAtom)

    // Use optimized variables data (already retrieved above)
    const variables = optimizedVariables

    const getProperty = useCallback(
        (property: any) => {
            if (!property) return null

            const {__metadata, value} = property

            // Smart handler with rowId-based routing (same logic as PlaygroundVariantPropertyControl)
            const handler = (e: any) => {
                const val =
                    e !== null && e !== undefined
                        ? typeof e === "object" && "target" in e
                            ? e.target.value
                            : e
                        : null

                const propertyId = property.__id
                if (!propertyId) return

                // No-op guard: avoid redundant mutations that can cause render loops.
                const currentVal = property?.value
                const isSame =
                    typeof val === "object" && val !== null
                        ? deepEqual(val, currentVal)
                        : val === currentVal
                if (!isTool && isSame) {
                    return
                }

                // Route mutations based on rowId presence (generation data vs variant data)
                if (rowId) {
                    // Handle generation data mutations when rowId is present
                    updateGenerationDataProperty({
                        rowId,
                        propertyId,
                        value: val,
                        messageId, // Pass messageId for message-specific updates
                    })
                } else if (variantId) {
                    // Prefer prompts-only facade when possible
                    if ((baseProperty as any)?.__id && propertyId === (baseProperty as any).__id) {
                        setBaseTextPromptValue(val)
                    } else if (
                        (baseContentProperty as any)?.__id &&
                        propertyId === (baseContentProperty as any).__id
                    ) {
                        setContentPromptValue(val)
                    } else {
                        updateVariantProperty?.({
                            variantId,
                            propertyId,
                            value: val,
                        })
                    }
                } else {
                    console.warn(
                        "⚠️ [PROMPT MESSAGE CONFIG] HANDLER Unable to determine mutation target:",
                        {
                            variantId,
                            rowId,
                            propertyId,
                        },
                    )
                }
            }

            return {
                __metadata: getMetadataLazy(__metadata),
                __id: property.__id,
                value: isTool ? property : value,
                handleChange: handler,
            }
        },
        [
            isTool,
            rowId,
            updateVariantProperty,
            updateGenerationDataProperty,
            variantId,
            (baseProperty as any)?.__id,
            (baseContentProperty as any)?.__id,
            setBaseTextPromptValue,
            setContentPromptValue,
        ],
    )

    const property = useMemo(() => {
        const result = getProperty(baseProperty)
        return result
    }, [baseProperty, getProperty])

    const imageProperties = useMemo(() => {
        return baseImageProperties?.map(getProperty)
    }, [baseImageProperties, getProperty])

    const contentProperty = useMemo(() => {
        return getProperty(baseContentProperty)
    }, [baseContentProperty, getProperty])

    // Defensive programming: Handle revoked proxy for property object
    let metadata: any
    let value: any
    let handleChange: any

    try {
        const safeProperty = property || {}
        metadata = safeProperty.__metadata
        value = safeProperty.value
        handleChange = safeProperty.handleChange
    } catch (error) {
        console.error("❌ [PromptMessageConfig] Error accessing property:", error)
        metadata = undefined
        value = undefined
        handleChange = undefined
    }

    const _value = useMemo(() => {
        if (isFunction) {
            return propsInitialValue || value
        } else if (isTool) {
            let _val = propsInitialValue || value
            const x = value
            if (Array.isArray(x)) {
                const textNode = x.filter(
                    (part) => part && typeof part === "object" && "text" in part,
                )
                return textNode.map((part: any) => part.text).join("")
            } else {
                return x || ""
            }
        } else {
            // Prefer message content over the whole message object when present
            const source = (contentProperty as any)?.value ?? value

            // Unwrap Enhanced value objects (e.g., { __id, __metadata, value: [...] })
            const raw = source as any
            const x = raw && typeof raw === "object" && "value" in raw ? raw.value : raw
            if (Array.isArray(x)) {
                const textNodes = x.filter((part) => {
                    // Check for text property and that it's a text type
                    if (!part || typeof part !== "object") return false
                    const hasText = "text" in part
                    const isTextType = (part as any)?.type?.value === "text"

                    return hasText && isTextType
                })

                return textNodes.map((part: any) => part.text?.value || "").join("")
            } else {
                return (typeof x === "string" ? x : "") || ""
            }
        }
    }, [debug, propsInitialValue, value, isFunction, isTool])

    const handleAddUploadSlot = useCallback(() => {
        const imageNodes = Array.isArray(contentProperty?.value)
            ? contentProperty.value.filter(
                  (part: any) => part && typeof part === "object" && "imageUrl" in part,
              )
            : []
        if (imageNodes?.length >= 5) return

        const itemMetadata = getMetadataLazy(
            contentProperty?.__metadata,
        )?.itemMetadata?.options?.find(
            (part: any) =>
                part &&
                typeof part === "object" &&
                part.properties &&
                typeof part.properties === "object" &&
                "imageUrl" in part.properties,
        )
        let imageNode = createObjectFromMetadata(itemMetadata)
        if (imageNode) {
            imageNode.type.value = "image_url"
        } else {
            // Fallback: construct a minimal image node when metadata is missing
            imageNode = {
                __id: generateId(),
                __metadata: {},
                type: {
                    __id: generateId(),
                    __metadata: {},
                    value: "image_url",
                },
                imageUrl: {
                    __id: generateId(),
                    __metadata: {},
                    url: {
                        __id: generateId(),
                        __metadata: {},
                        value: "",
                    },
                    detail: {
                        __id: generateId(),
                        __metadata: {},
                        value: "auto",
                    },
                },
            } as any
        }

        // When content is not an array (e.g., plain string), coerce it into a single text node
        // so we can append image nodes safely.
        let baseArray: any[]
        if (Array.isArray(contentProperty?.value)) {
            baseArray = contentProperty!.value
        } else {
            // Try to construct a text node from metadata; otherwise, create a minimal text node
            const textItemMetadata = getMetadataLazy(
                contentProperty?.__metadata,
            )?.itemMetadata?.options?.find(
                (part: any) =>
                    part &&
                    typeof part === "object" &&
                    part.properties &&
                    typeof part.properties === "object" &&
                    "text" in part.properties,
            )
            let textNode = createObjectFromMetadata(textItemMetadata)
            const existing = (contentProperty as any)?.value
            if (textNode) {
                textNode.type.value = "text"
                if (textNode.text) {
                    if (typeof existing === "string") {
                        textNode.text.value = existing
                    } else if (existing && typeof existing === "object" && "value" in existing) {
                        textNode.text.value = (existing as any).value ?? ""
                    } else {
                        textNode.text.value = ""
                    }
                }
            } else {
                textNode = {
                    __id: generateId(),
                    __metadata: {},
                    type: {
                        __id: generateId(),
                        __metadata: {},
                        value: "text",
                    },
                    text: {
                        __id: generateId(),
                        __metadata: {},
                        value:
                            typeof existing === "string"
                                ? existing
                                : existing && typeof existing === "object" && "value" in existing
                                  ? ((existing as any).value ?? "")
                                  : "",
                    },
                } as any
            }
            baseArray = [textNode]
        }

        const newValue = [...baseArray, imageNode]

        // Use the proper mutation approach instead of direct handleChange
        const targetPropertyId = baseContentProperty?.__id ?? contentProperty?.__id
        if (rowId && targetPropertyId) {
            updateGenerationDataProperty({
                rowId,
                propertyId: targetPropertyId,
                value: newValue,
                messageId, // Pass messageId for message-specific updates
            })
        } else if (variantId) {
            // For variant prompts, the write atom already knows the property
            setContentPromptValue(newValue)
        } else {
            console.warn("⚠️ [handleAddUploadSlot] Unable to determine mutation target:", {
                variantId,
                rowId,
                propertyId: targetPropertyId,
            })
        }
    }, [
        contentProperty,
        baseContentProperty,
        rowId,
        messageId,
        variantId,
        updateGenerationDataProperty,
        updateVariantProperty,
    ])

    const handleRemoveFileItem = useCallback(
        (propertyId: string) => {
            if (!contentProperty) return
            const cloned = structuredClone(contentProperty.value)
            const index = cloned.findIndex((part: any) => {
                if (!part || typeof part !== "object") return false
                const found = findPropertyInObject(part, propertyId)
                return !!found
            })
            if (index >= 0) {
                // remove item at index
                cloned.splice(index, 1)

                // Use the proper mutation approach instead of direct handleChange
                if (rowId && baseContentProperty?.__id) {
                    updateGenerationDataProperty({
                        rowId,
                        propertyId: baseContentProperty.__id,
                        value: cloned,
                        messageId, // Pass messageId for message-specific updates
                    })
                } else if (variantId && baseContentProperty?.__id) {
                    setContentPromptValue(cloned)
                } else {
                    console.warn("⚠️ [handleRemoveFileItem] Unable to determine mutation target:", {
                        variantId,
                        rowId,
                        propertyId: baseContentProperty?.__id,
                    })
                }
            }
        },
        [
            contentProperty,
            baseContentProperty,
            rowId,
            messageId,
            variantId,
            updateGenerationDataProperty,
            updateVariantProperty,
        ],
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

    // Derive existing trace/result hashes for this turn across the scoped variants
    const displayedVariantIds = useAtomValue(displayedVariantsAtom) as string[] | undefined
    const runStatusMap = useAtomValue(runStatusByRowRevisionAtom) as Record<string, any>
    const _resultHashes = useMemo(() => {
        try {
            const scopedIds: string[] = (() => {
                if (revisionId) return [revisionId as string]
                return Array.isArray(displayedVariantIds) ? displayedVariantIds : []
            })()

            if (!rowId || scopedIds.length === 0) return []

            const hashes: string[] = []
            for (const vid of scopedIds) {
                const key = `${rowId}:${vid}`
                const entry = (runStatusMap || {})[key]
                const h = entry?.resultHash
                if (h) hashes.push(h)
            }
            return hashes
        } catch {
            return []
        }
    }, [runStatusMap, rowId, revisionId, displayedVariantIds])

    const toolInfo = useMemo(() => {
        if (!message || !isTool) return null
        const _value = propsInitialValue || value
        if (typeof _value === "string") {
            try {
                return JSON5.parse(_value)
            } catch {
                return null
            }
        }
        return _value
    }, [propsInitialValue, message, value, isTool])

    const _placeholder = useMemo(() => {
        return isFunction ? "Enter function output" : placeholder
    }, [isFunction, placeholder])

    if (debug) {
        // Extract actual text content for better debugging
        let _actualTextValue = null
        try {
            if (value && Array.isArray(value)) {
                // For content arrays, extract text from first text item
                const textItem = value.find((item: any) => item?.type?.value === "text")
                _actualTextValue = textItem?.text?.value || null
            } else if (typeof value === "string") {
                _actualTextValue = value
            } else if (value && typeof value === "object") {
                _actualTextValue = JSON.stringify(value, null, 2)
            }
        } catch (error) {
            _actualTextValue = "[Error extracting value]"
        }
    }

    if (!message) {
        return null
    }
    // Allow rendering in read-only when property metadata is missing (raw prompts)
    if (!property) {
        // render in read-only without extra logs
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
                                propertyId={message.role.__id}
                                variantId={variantId}
                                rowId={rowId}
                                as="SimpleDropdownSelect"
                                className="message-user-select"
                                disabled={disabled}
                            />
                            {!disabled && (
                                <PromptMessageContentOptions
                                    className="invisible group-hover/item:visible"
                                    propertyId={message.content?.__id}
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
                                    allowFileUpload={
                                        allowFileUpload && message?.role?.value === ChatRole.User
                                    }
                                    uploadCount={imageProperties?.length}
                                    hideMarkdownToggle={true}
                                />
                            )}
                        </div>
                        <div className="w-full pb-2 pt-0 flex items-center justify-between">
                            {message.name && (
                                <PlaygroundVariantPropertyControl
                                    propertyId={message.name}
                                    variantId={variantId}
                                    rowId={rowId}
                                    as="SimpleInput"
                                    className="message-user-select px-0"
                                    disabled={disabled}
                                    placeholder="Function name"
                                />
                            )}
                            {message.toolCallId && (
                                <PlaygroundVariantPropertyControl
                                    propertyId={message.toolCallId}
                                    variantId={variantId}
                                    rowId={rowId}
                                    as="SimpleInput"
                                    className="message-user-select px-0 text-right"
                                    disabled={disabled}
                                    placeholder="Tool call id"
                                />
                            )}
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
                                propertyId={message.role?.__id}
                                variantId={variantId}
                                rowId={rowId}
                                as="SimpleDropdownSelect"
                                className="message-user-select"
                                disabled={disabled}
                            />
                            {!disabled && (
                                <PromptMessageContentOptions
                                    className="invisible group-hover/item:visible"
                                    propertyId={message.content?.__id}
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
                                    allowFileUpload={
                                        allowFileUpload && message?.role?.value === ChatRole.User
                                    }
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
                        {message.role?.__id ? (
                            <PlaygroundVariantPropertyControl
                                propertyId={message.role.__id}
                                variantId={variantId}
                                rowId={rowId}
                                messageId={messageId}
                                as="SimpleDropdownSelect"
                                className="message-user-select"
                                disabled={disabled || viewOnly}
                            />
                        ) : null}

                        {!disabled && (
                            <>
                                <PromptMessageContentOptions
                                    className="invisible group-hover/item:visible"
                                    propertyId={message.content?.__id}
                                    variantId={variantId}
                                    messageId={messageId}
                                    isMessageDeletable={isMessageDeletable}
                                    disabled={disabled}
                                    runnable={runnable}
                                    resultHashes={_resultHashes}
                                    minimized={minimized}
                                    actions={{
                                        deleteMessage,
                                        rerunMessage,
                                        minimize: () => {
                                            setMinimized((current) => !current)
                                        },
                                        handleAddUploadSlot,
                                    }}
                                    allowFileUpload={
                                        allowFileUpload && message?.role?.value === ChatRole.User
                                    }
                                    uploadCount={imageProperties?.length}
                                    viewOnly={viewOnly}
                                />
                            </>
                        )}
                    </div>
                )
            }
            key={`${isTool}-${messageId}`}
            handleChange={propsHandleChange || handleChange}
            initialValue={_value}
            editorClassName={editorClassName}
            placeholder={_placeholder || metadata?.description}
            disabled={disabled || viewOnly}
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
                        {imageProperties?.length > 0
                            ? imageProperties.map((property) => {
                                  // Derive current URL from the property value
                                  const currentUrl =
                                      property &&
                                      typeof property.value === "object" &&
                                      property.value
                                          ? ((property.value as any).value ?? "")
                                          : ((property as any)?.value ?? "")

                                  return (
                                      <PromptImageUpload
                                          key={property.__id}
                                          disabled={disabled}
                                          imageFile={{
                                              status: "done",
                                              thumbUrl: currentUrl,
                                              uid: currentUrl || property.__id,
                                              name: currentUrl || property.__id,
                                          }}
                                          handleUploadFileChange={(newFile) => {
                                              const imagePart =
                                                  newFile?.url || newFile?.thumbUrl || ""
                                              if (!imagePart) return

                                              if (property && contentProperty?.value) {
                                                  const cloned = structuredClone(
                                                      contentProperty.value,
                                                  )
                                                  const targetIndex = cloned.findIndex(
                                                      (part: any) =>
                                                          Boolean(
                                                              findPropertyInObject(
                                                                  part,
                                                                  property.__id,
                                                              ),
                                                          ),
                                                  )
                                                  if (targetIndex >= 0) {
                                                      const targetPart = cloned[targetIndex]
                                                      const urlProp = findPropertyInObject(
                                                          targetPart,
                                                          property.__id,
                                                      ) as any
                                                      if (urlProp) {
                                                          if (
                                                              urlProp.content &&
                                                              typeof urlProp.content === "object"
                                                          ) {
                                                              urlProp.content.value = imagePart
                                                          } else {
                                                              urlProp.value = imagePart
                                                          }
                                                      }

                                                      if (rowId && baseContentProperty?.__id) {
                                                          updateGenerationDataProperty({
                                                              rowId,
                                                              propertyId: baseContentProperty.__id,
                                                              value: cloned,
                                                              messageId,
                                                          })
                                                      } else if (
                                                          variantId &&
                                                          baseContentProperty?.__id
                                                      ) {
                                                          setContentPromptValue(cloned)
                                                      }
                                                  }
                                              }
                                          }}
                                          handleRemoveUploadFile={() => {
                                              handleRemoveFileItem(property.__id)
                                          }}
                                      />
                                  )
                              })
                            : null}
                    </div>

                    {props.footer}
                </div>
            }
        />
    )
}

const PromptMessageConfigWrapper = (props: PromptMessageConfigProps) => {
    // Simplified wrapper - use default values for now
    // These can be enhanced later with proper atom-based detection
    const isTool = false // Default value
    const isFunction = false // Default value
    const isJSON = false // Default value

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
