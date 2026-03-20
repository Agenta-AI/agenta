import {
    ChangeEvent,
    ClipboardEvent,
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import {useDebounceInput} from "@agenta/shared/hooks"
import {Input, Spin} from "antd"
import type {TextAreaProps} from "antd/es/input"
import clsx from "clsx"
import {v4 as uuidv4} from "uuid"

import {Editor, isLargeRichTextDocument} from "../Editor"

import type {SharedEditorProps} from "./types"

const LARGE_INPUT_EXTERNAL_COMMIT_DELAY_MS = 180

function looksLikePlainTextContent(value: string): boolean {
    if (!value) {
        return true
    }

    return !/(^|\n)\s{0,3}[#>*-]|\[[^\]]+\]\([^)]+\)|`{1,3}|\*\*|__/.test(value)
}

function getSelectionOffsets(rootElement: HTMLElement): {start: number; end: number} | null {
    if (typeof window === "undefined") {
        return null
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
        return null
    }

    const range = selection.getRangeAt(0)
    if (!rootElement.contains(range.startContainer) || !rootElement.contains(range.endContainer)) {
        return null
    }

    const prefixRange = range.cloneRange()
    prefixRange.selectNodeContents(rootElement)
    prefixRange.setEnd(range.startContainer, range.startOffset)

    const start = prefixRange.toString().length
    const end = start + range.toString().length
    return {start, end}
}

function applyPasteToValue(
    currentValue: string,
    pastedValue: string,
    selectionOffsets: {start: number; end: number} | null,
): string {
    if (!selectionOffsets) {
        return `${currentValue}${pastedValue}`
    }

    const start = Math.max(0, Math.min(selectionOffsets.start, currentValue.length))
    const end = Math.max(start, Math.min(selectionOffsets.end, currentValue.length))
    return `${currentValue.slice(0, start)}${pastedValue}${currentValue.slice(end)}`
}

/**
 * SharedEditor - A flexible editor wrapper with support for both rich text and code editing.
 *
 * Features:
 * - Borderless or bordered styling
 * - Debounced input handling
 * - Optional header/footer slots
 * - Support for antd Input as fallback
 * - Code-only mode with syntax highlighting
 *
 * @example
 * ```tsx
 * <SharedEditor
 *   initialValue="Hello World"
 *   handleChange={(value) => console.log(value)}
 *   placeholder="Enter text..."
 * />
 * ```
 *
 * @example Code editor mode
 * ```tsx
 * <SharedEditor
 *   initialValue='{"key": "value"}'
 *   editorProps={{ codeOnly: true, language: "json" }}
 *   handleChange={(value) => console.log(value)}
 * />
 * ```
 */
const SharedEditor = ({
    id,
    header,
    footer,
    editorType = "borderless",
    state = "filled",
    placeholder,
    initialValue,
    value,
    editorClassName,
    disabled,
    handleChange,
    editorProps,
    className,
    autoFocus,
    error,
    useAntdInput = false,
    optimizeLargeInput = false,
    disableContainerTransition = false,
    noProvider = false,
    debug = false,
    isTool,
    propertyId,
    baseProperty,
    variantId,
    syncWithInitialValueChanges = false,
    disableDebounce = false,
    antdInputProps,
    onPropertyClick,
    onFocusChange,
    ...props
}: SharedEditorProps) => {
    const normalizedInitialValue = initialValue ?? ""
    const controlledValue = value !== undefined ? value : normalizedInitialValue
    const shouldOptimizeLargeInput = optimizeLargeInput && !editorProps?.codeOnly

    const [isEditorFocused, setIsEditorFocused] = useState(false)
    const [forcePlainTextFallback, setForcePlainTextFallback] = useState(
        shouldOptimizeLargeInput && isLargeRichTextDocument(controlledValue),
    )
    const [isHandlingLargePaste, setIsHandlingLargePaste] = useState(false)

    const [localValue, setLocalValue] = useDebounceInput<string>(
        controlledValue,
        disableDebounce ? () => {} : handleChange || (() => {}),
        disableDebounce ? 0 : 300,
        "",
    )

    const deferredLargeCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (shouldOptimizeLargeInput && isLargeRichTextDocument(controlledValue)) {
            setForcePlainTextFallback(true)
        }
    }, [controlledValue, shouldOptimizeLargeInput])

    useEffect(
        () => () => {
            if (deferredLargeCommitRef.current != null) {
                clearTimeout(deferredLargeCommitRef.current)
                deferredLargeCommitRef.current = null
            }
        },
        [],
    )

    const commitExternalChange = useCallback(
        (nextValue: string) => {
            if (!disableDebounce || !handleChange) {
                return
            }

            if (shouldOptimizeLargeInput && isLargeRichTextDocument(nextValue)) {
                if (deferredLargeCommitRef.current != null) {
                    clearTimeout(deferredLargeCommitRef.current)
                }

                deferredLargeCommitRef.current = setTimeout(() => {
                    deferredLargeCommitRef.current = null
                    handleChange(nextValue)
                }, LARGE_INPUT_EXTERNAL_COMMIT_DELAY_MS)
                return
            }

            handleChange(nextValue)
        },
        [disableDebounce, handleChange, shouldOptimizeLargeInput],
    )

    const handleLocalValueChange = useCallback(
        (nextValue: string) => {
            setLocalValue(nextValue)
            commitExternalChange(nextValue)
        },
        [commitExternalChange, setLocalValue],
    )

    const editorIdRef = useRef<string>(
        id || `${uuidv4()}-${editorProps?.codeOnly ? "code" : "text"}`,
    )
    const editorId = editorIdRef.current

    const mountInitialValueRef = useRef<string>(normalizedInitialValue)

    if (syncWithInitialValueChanges) {
        mountInitialValueRef.current = normalizedInitialValue
    }

    const handleAntdInputChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            handleLocalValueChange(event.target.value)
        },
        [handleLocalValueChange],
    )

    const handleAntdTextAreaChange = useCallback(
        (event: ChangeEvent<HTMLTextAreaElement>) => {
            handleLocalValueChange(event.target.value)
        },
        [handleLocalValueChange],
    )

    const usesPlainTextInput = useAntdInput || forcePlainTextFallback

    const handleLargePasteCapture = useCallback(
        (event: ClipboardEvent<HTMLDivElement>) => {
            if (disabled || !shouldOptimizeLargeInput || usesPlainTextInput) {
                return
            }

            const pastedText = event.clipboardData?.getData("text/plain") ?? ""
            if (!isLargeRichTextDocument(pastedText)) {
                return
            }

            const target = event.target as HTMLElement | null
            const contentEditable = target?.closest(".editor-input") as HTMLElement | null
            if (!contentEditable) {
                return
            }

            const isMarkdownSource = contentEditable.classList.contains("markdown-view")
            if (!isMarkdownSource && localValue && !looksLikePlainTextContent(localValue)) {
                return
            }

            event.preventDefault()
            event.stopPropagation()

            const nextValue = applyPasteToValue(
                localValue,
                pastedText,
                getSelectionOffsets(contentEditable),
            )

            setIsHandlingLargePaste(true)

            const commitLargePaste = () => {
                startTransition(() => {
                    setForcePlainTextFallback(true)
                    handleLocalValueChange(nextValue)
                })

                if (
                    typeof window !== "undefined" &&
                    typeof window.requestAnimationFrame === "function"
                ) {
                    window.requestAnimationFrame(() => {
                        setIsHandlingLargePaste(false)
                    })
                    return
                }

                setIsHandlingLargePaste(false)
            }

            if (
                typeof window !== "undefined" &&
                typeof window.requestAnimationFrame === "function"
            ) {
                window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(commitLargePaste)
                })
                return
            }

            setTimeout(commitLargePaste, 0)
        },
        [
            disabled,
            handleLocalValueChange,
            localValue,
            shouldOptimizeLargeInput,
            usesPlainTextInput,
        ],
    )

    const mergedContainerClassName = useMemo(
        () =>
            clsx(
                "agenta-shared-editor",
                "w-auto flex flex-col items-start relative group/item border border-solid rounded-lg",
                {"transition-all duration-300 ease-in-out": !disableContainerTransition},
                "[&_.agenta-rich-text-editor]:w-full",
                "[&_.agenta-editor-wrapper]:w-full",
                "p-[11px]",
                "[&_.ant-dropdown-trigger]:pl-0",
                {
                    "border-[#BDC7D1]": editorType === "border",
                    "hover:border-[#394857] focus:border-[#BDC7D1]": editorType === "border",
                    "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none":
                        ["readOnly", "disabled"].includes(state) && editorType === "border",
                    "hover:border-[394857] focus:border-[394857]":
                        state === "filled" && editorType === "border",
                },
                {
                    "border-[transparent] hover:!border-[#BDC7D1] focus:border-[#BDC7D1]":
                        editorType === "borderless",
                    "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none":
                        ["readOnly", "disabled"].includes(state) && editorType === "borderless",
                    "hover:border-[transparent] focus:border-[transparent]":
                        state === "filled" && editorType === "borderless",
                },
                {
                    "[&_.agenta-rich-text-editor_*]:!text-[red] [&_.message-user-select]:text-[red]":
                        error,
                    "pt-0 [&_.editor-code]:!pr-2 [&_.editor-code]:!bg-[transparent] [&_.editor-code]:!m-0 [&_.editor-code]:!pt-2 [&_.editor-code]:!pb-1 [&_.agenta-editor-wrapper]:!-ml-[12px] [&_.agenta-editor-wrapper]:!w-[calc(100%+24px)] [&_.agenta-editor-wrapper]:mb-1 overflow-hidden":
                        editorProps?.codeOnly,
                },
                isEditorFocused && "!border-[#BDC7D1]",
                className,
            ),
        [
            className,
            disableContainerTransition,
            editorProps?.codeOnly,
            editorType,
            error,
            isEditorFocused,
            state,
        ],
    )

    return (
        <div
            className={mergedContainerClassName}
            {...props}
            style={
                {
                    ...props.style,
                    interpolateSize: "allow-keywords",
                    height: "var(--editor-h, auto)",
                    overflow: "hidden",
                    transitionProperty: "height",
                    transitionDuration: "300ms",
                    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                } as React.CSSProperties
            }
            onPasteCapture={handleLargePasteCapture}
            onFocus={() => {
                setIsEditorFocused(true)
                onFocusChange?.(true)
            }}
            onBlur={() => {
                setIsEditorFocused(false)
                onFocusChange?.(false)
            }}
        >
            {header}

            {isHandlingLargePaste ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-[rgba(255,255,255,0.78)] backdrop-blur-[1px]">
                    <Spin size="small" />
                    <span className="text-[13px] text-[rgba(5,23,41,0.72)]">
                        Pasting large content…
                    </span>
                </div>
            ) : null}

            {usesPlainTextInput ? (
                (() => {
                    const inputProps = antdInputProps ?? {}
                    const shouldRenderTextarea =
                        forcePlainTextFallback || ("textarea" in inputProps && inputProps.textarea)

                    if (shouldRenderTextarea) {
                        const textAreaProps = (
                            "textarea" in inputProps && inputProps.textarea
                                ? inputProps
                                : {textarea: true}
                        ) as TextAreaProps & {textarea: true}
                        const {textarea: _, className: __, ...textAreaRest} = textAreaProps
                        return (
                            <Input.TextArea
                                placeholder={placeholder}
                                value={localValue}
                                onChange={handleAntdTextAreaChange}
                                className={clsx(
                                    "!bg-transparent",
                                    "!text-inherit",
                                    editorClassName,
                                    textAreaProps.className,
                                )}
                                disabled={disabled}
                                autoSize={textAreaRest.autoSize ?? {minRows: 6, maxRows: 18}}
                                {...textAreaRest}
                            />
                        )
                    }

                    const {textarea: _, className: __, ...inputRest} = inputProps
                    return (
                        <Input
                            placeholder={placeholder}
                            value={localValue}
                            onChange={handleAntdInputChange}
                            className={clsx(
                                "!bg-transparent",
                                "!text-inherit",
                                editorClassName,
                                inputProps.className,
                            )}
                            disabled={disabled}
                            {...inputRest}
                        />
                    )
                })()
            ) : (
                <Editor
                    placeholder={placeholder}
                    showToolbar={false}
                    enableTokens={!editorProps?.codeOnly}
                    initialValue={mountInitialValueRef.current}
                    value={localValue}
                    className={editorClassName}
                    onChange={(val) => {
                        handleLocalValueChange(val.textContent)
                    }}
                    debug={debug}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    showBorder={false}
                    id={editorId}
                    noProvider={noProvider}
                    {...editorProps}
                    onPropertyClick={onPropertyClick}
                />
            )}

            {footer}
        </div>
    )
}

export default SharedEditor
