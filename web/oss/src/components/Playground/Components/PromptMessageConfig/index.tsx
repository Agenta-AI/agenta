import {useMemo, useCallback, useState, useEffect, useRef} from "react"

import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useSetAtom, useAtomValue} from "jotai"
import {$getRoot} from "lexical"
import {v4 as uuidv4} from "uuid"

import {useLexicalComposerContext, EditorProvider} from "@/oss/components/Editor/Editor"
import {$isCodeBlockNode} from "@/oss/components/Editor/plugins/code/nodes/CodeBlockNode"
import PromptMessageHeader from "@/oss/components/Playground/Components/Shared/PromptMessageHeader"
import {useMessageContentHandlers} from "@/oss/components/Playground/hooks/useMessageContentHandlers"
import {useMessageContentProps} from "@/oss/components/Playground/hooks/useMessageContentProps"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {ChatRole} from "@/oss/lib/Types"
import {runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"

import {findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"
import {usePromptMessageConfig} from "../../hooks/usePromptMessageConfig"
import {
    // updateGenerationDataPropertyMutationAtom,
    promptPropertyAtomFamily,
    updateVariantPropertyEnhancedMutationAtom,
    displayedVariantsAtom,
} from "../../state/atoms"
import PromptImageUpload from "../PlaygroundVariantPropertyControl/assets/PromptImageUpload"
import SharedEditor from "../SharedEditor"

import type {PromptMessageConfigProps} from "./types"

// Content options moved into PromptMessageHeader; dynamic import removed

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
    id,
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
    const editorIdRef = useRef(id || uuidv4())
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
    // Prompt-only message resolution
    const message = (optimizedMessage as any) ?? (messageProp as any)

    // Get variant data directly from atoms to avoid data contamination
    // const playgroundVariants = useAtomValue(playgroundVariantsAtom)
    // const variant = playgroundVariants?.[variantId || ""]

    // Get optimized mutation functions
    const updateVariantProperty = useSetAtom(updateVariantPropertyEnhancedMutationAtom)
    // const updateGenerationDataProperty = useSetAtom(updateGenerationDataPropertyMutationAtom)

    // Facade write setup for content property (prompts-only). Fallback to noop when unavailable.
    const noopWriteAtom = useMemo(() => atom(null, () => {}), [])
    const revisionId = useMemo(() => {
        return variantId && typeof variantId === "object"
            ? (variantId as any).id
            : (variantId as any)
    }, [variantId])

    // content write facade is defined after baseContentProperty to use the correct property id

    // Essential property extraction for message rendering via shared hook
    const {baseProperty, isTool, baseImageProperties, baseContentProperty} = useMessageContentProps(
        message as any,
    )

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

                // Prompt-only mutations (variant-scoped)
                if (variantId) {
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
                        "⚠️ [PROMPT MESSAGE CONFIG] Prompt-only component missing variantId",
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
            // updateGenerationDataProperty,
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
        const safeProperty: any = property || {}
        metadata = safeProperty.__metadata
        value = safeProperty.value
        handleChange = safeProperty.handleChange
    } catch (error) {
        console.error("❌ [PromptMessageConfig] Error accessing property:", error)
        metadata = undefined
        value = undefined
        handleChange = undefined
    }

    const {computeDisplayValue, addUploadSlot} = useMessageContentHandlers()
    const _value = useMemo(
        () =>
            computeDisplayValue({
                propsInitialValue,
                value,
                isFunction: Boolean(isFunction),
                isTool: Boolean(isTool),
                contentProperty: contentProperty as any,
            }),
        [computeDisplayValue, propsInitialValue, value, isFunction, isTool, contentProperty],
    )

    const handleAddUploadSlot = useCallback(() => {
        const result = addUploadSlot({contentProperty: contentProperty as any, max: 5})
        if (!result) return
        setContentPromptValue(result as any)
    }, [addUploadSlot, contentProperty, setContentPromptValue])

    const handleRemoveFileItem = useCallback(
        (propertyId: string) => {
            if (!contentProperty) return
            const cloned = removeUploadItem({contentProperty: contentProperty as any, propertyId})
            if (!cloned) return
            if (variantId && baseContentProperty?.__id) {
                setContentPromptValue(cloned as any)
            } else {
                console.warn("⚠️ [handleRemoveFileItem] Unable to determine mutation target:", {
                    variantId,
                    rowId,
                    propertyId: baseContentProperty?.__id,
                })
            }
        },
        [contentProperty, baseContentProperty, setContentPromptValue, variantId, rowId],
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

    // toolInfo no longer needed after header extraction

    const _placeholder = useMemo(() => {
        return isFunction ? "Enter function output" : placeholder
    }, [isFunction, placeholder])

    if (!message) {
        return null
    }

    return (
        <SharedEditor
            id={editorIdRef.current}
            header={
                <PromptMessageHeader
                    id={editorIdRef.current}
                    variantId={variantId}
                    rowId={rowId}
                    messageId={messageId}
                    isFunction={Boolean(isFunction)}
                    isTool={Boolean(isTool)}
                    disabled={disabled}
                    minimized={minimized}
                    className="w-full"
                    headerClassName={headerClassName}
                    rolePropertyId={message.role?.__id}
                    contentPropertyId={message.content?.__id}
                    functionNamePropertyId={isFunction ? (message as any).name : undefined}
                    toolCallIdPropertyId={isFunction ? (message as any).toolCallId : undefined}
                    allowFileUpload={allowFileUpload && message?.role?.value === ChatRole.User}
                    uploadCount={imageProperties?.length || 0}
                    resultHashes={_resultHashes}
                    viewOnly={viewOnly}
                    hideMarkdownToggle
                    actions={{
                        onDelete: deleteMessage,
                        onRerun: rerunMessage,
                        onMinimize: () => setMinimized((c) => !c),
                        onAddUploadSlot: handleAddUploadSlot,
                    }}
                />
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
                                                          //   updateGenerationDataProperty({
                                                          //       rowId,
                                                          //       propertyId: baseContentProperty.__id,
                                                          //       value: cloned,
                                                          //       messageId,
                                                          //   })
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
    const editorIdRef = useRef(uuidv4())

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
                    allowFileUpload={true}
                    id={editorIdRef.current}
                    {...props}
                />
            </EditorProvider>
        </div>
    )
}
export default PromptMessageConfigWrapper
