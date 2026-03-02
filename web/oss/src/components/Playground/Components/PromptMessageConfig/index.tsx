import {useMemo, useCallback, useState, useEffect, useRef} from "react"

import {getMetadataLazy} from "@agenta/entities/legacyAppRevision"
import {mergeRegister} from "@lexical/utils"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useSetAtom} from "jotai"
import {useAtomValue} from "jotai"
import {$getRoot} from "lexical"
import {v4 as uuidv4} from "uuid"

import {useLexicalComposerContext, EditorProvider} from "@/oss/components/Editor/Editor"
import {$isCodeBlockNode} from "@/oss/components/Editor/plugins/code/nodes/CodeBlockNode"
import PromptMessageHeader from "@/oss/components/Playground/Components/Shared/PromptMessageHeader"
import {useMessageContentHandlers} from "@/oss/components/Playground/hooks/useMessageContentHandlers"
import {useMessageContentProps} from "@/oss/components/Playground/hooks/useMessageContentProps"

import {usePromptMessageConfig} from "../../hooks/usePromptMessageConfig"
import {
    // updateGenerationDataPropertyMutationAtom,
    promptPropertyAtomFamily,
    promptTemplateFormatAtomFamily,
} from "../../state/atoms"
import {updateVariantPropertyEnhancedMutationAtom} from "../../state/atoms/propertyMutations"
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
    isTool,
    message: messageProp,
    viewOnly,
    defaultMinimized,
    showMinimizeOnly,
    ...props
}: PromptMessageConfigProps) => {
    const editorIdRef = useRef(id || uuidv4())
    // Allow null to represent an empty upload slot
    // const [uploadedFileItems, setUploadedFileItems] = useState<(UploadFile | null)[]>([])
    const [minimized, setMinimized] = useState(Boolean(defaultMinimized))

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
    const {baseProperty, baseImageProperties, baseContentProperty} = useMessageContentProps(
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

    // Template format for token highlighting (curly | fstring | jinja2)
    const templateFormat = useAtomValue(
        useMemo(() => promptTemplateFormatAtomFamily(revisionId), [revisionId]),
    )

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

    const {computeDisplayValue} = useMessageContentHandlers()
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
                    isFunction={Boolean(isFunction) || Boolean(isTool)}
                    isTool={Boolean(isTool)}
                    disabled={disabled}
                    minimized={minimized}
                    className="w-full"
                    headerClassName={headerClassName}
                    rolePropertyId={message.role?.__id}
                    contentPropertyId={message.content?.__id}
                    functionNamePropertyId={
                        Boolean(isFunction) || Boolean(isTool)
                            ? (message as any).name?.__id
                            : undefined
                    }
                    toolCallIdPropertyId={
                        Boolean(isFunction) || Boolean(isTool)
                            ? (message as any).toolCallId?.__id
                            : undefined
                    }
                    uploadCount={imageProperties?.length || 0}
                    viewOnly={viewOnly}
                    hideMarkdownToggle={Boolean(isFunction || isTool)}
                    showMinimizeOnly={showMinimizeOnly}
                    actions={{
                        onDelete: deleteMessage,
                        onMinimize: () => setMinimized((c) => !c),
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
                templateFormat,
                showToolbar: false,
                ...(editorProps || {}),
            }}
            {...props}
            footer={
                <div className="w-full">
                    <div className="flex flex-col my-2 items-center gap-2"></div>

                    {props.footer ? props.footer : null}
                </div>
            }
        />
    )
}

const PromptMessageConfigWrapper = (props: PromptMessageConfigProps) => {
    const isFunction = false // Default value
    const isJSON = false // Default value
    const editorIdRef = useRef(uuidv4())

    const {message} = usePromptMessageConfig({
        variantId: props.variantId,
        messageId: props.messageId,
        rowId: props.rowId,
    })

    const isTool = useMemo(() => message?.role?.value === "tool", [message])

    return (
        <div className="w-full relative">
            <EditorProvider
                key={`${editorIdRef.current}-${isTool}`}
                codeOnly={isTool || isJSON}
                enableTokens={!(isTool || isJSON)}
                showToolbar={false}
            >
                <PromptMessageConfig
                    isJSON={isJSON}
                    isFunction={isFunction}
                    isTool={isTool}
                    id={`${editorIdRef.current}-${isTool}`}
                    {...props}
                />
            </EditorProvider>
        </div>
    )
}
export default PromptMessageConfigWrapper
