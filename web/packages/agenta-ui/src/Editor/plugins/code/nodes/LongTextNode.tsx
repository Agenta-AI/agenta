/**
 * LongTextNode.tsx
 *
 * A custom Lexical node for rendering long text strings in a collapsed/truncated view.
 * Shows a preview with character count and allows viewing the full content via drill-in.
 */
import React, {type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {TextAlignLeft, ArrowSquareOut} from "@phosphor-icons/react"
import {
    DecoratorNode,
    EditorConfig,
    LexicalNode,
    NodeKey,
    SerializedLexicalNode,
    Spread,
} from "lexical"

import {Button} from "../../../../components/ui/button"
import {Popover, PopoverAnchor, PopoverContent} from "../../../../components/ui/popover"
import {message} from "../../../../utils/appMessageContext"
import {useDrillInContext} from "../context/DrillInContext"

/** Minimum length for a string to be considered "long" and truncated */
const MIN_LENGTH_FOR_TRUNCATION = 200

/** Maximum length to show in truncated view */
const TRUNCATE_LENGTH = 80

/**
 * Check if a string is long enough to be truncated
 */
export function isLongTextString(value: string): boolean {
    // Must be a quoted string and exceed minimum length
    if (!value.startsWith('"') || !value.endsWith('"')) return false
    const content = value.slice(1, -1)
    return content.length > MIN_LENGTH_FOR_TRUNCATION
}

/**
 * Extract truncated preview from long text string
 */
export function parseLongTextString(value: string): {
    preview: string
    fullValue: string
    charCount: number
} {
    // Remove surrounding quotes
    const content = value.replace(/^"|"$/g, "")
    const charCount = content.length

    if (charCount <= MIN_LENGTH_FOR_TRUNCATION) {
        return {
            preview: content,
            fullValue: content,
            charCount,
        }
    }

    const truncated = content.substring(0, TRUNCATE_LENGTH)
    return {
        preview: truncated,
        fullValue: content,
        charCount,
    }
}

/**
 * Format character count for display
 */
function formatCharCount(count: number): string {
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k chars`
    }
    return `${count} chars`
}

/**
 * Decode escaped JSON string characters (e.g. "\n", "\t") for display-only rendering.
 * Falls back to the raw value if decoding fails.
 */
function decodeEscapedJsonString(value: string): string {
    let decoded = value

    // Decode common escaped control chars for display.
    // We do at most two passes to support both "\n" and "\\n" source encodings
    // while keeping this inexpensive for long strings.
    for (let i = 0; i < 2; i += 1) {
        const next = decoded
            .replace(/\\\\r\\\\n/g, "\r\n")
            .replace(/\\\\n/g, "\n")
            .replace(/\\\\r/g, "\r")
            .replace(/\\\\t/g, "\t")
            .replace(/\\r\\n/g, "\r\n")
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")

        if (next === decoded) break
        decoded = next
    }

    return decoded
}

/**
 * Serialized form of LongTextNode
 */
export type SerializedLongTextNode = Spread<
    {
        fullValue: string
        highlightType: string
    },
    SerializedLexicalNode
>

/**
 * Hover-open state for a Radix Popover, reproducing antd `trigger="hover"`
 * (open after `enterDelayMs`, close after `leaveDelayMs`).
 */
function useHoverOpen(enterDelayMs: number, leaveDelayMs: number) {
    const [open, setOpen] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearTimer = useCallback(() => {
        if (timerRef.current != null) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    useEffect(() => clearTimer, [clearTimer])

    const schedule = useCallback(
        (next: boolean, delay: number) => {
            clearTimer()
            timerRef.current = setTimeout(() => {
                timerRef.current = null
                setOpen(next)
            }, delay)
        },
        [clearTimer],
    )

    const onMouseEnter = useCallback(() => schedule(true, enterDelayMs), [schedule, enterDelayMs])
    const onMouseLeave = useCallback(() => schedule(false, leaveDelayMs), [schedule, leaveDelayMs])
    const setOpenNow = useCallback(
        (next: boolean) => {
            clearTimer()
            setOpen(next)
        },
        [clearTimer],
    )

    return {open, setOpen: setOpenNow, hoverProps: {onMouseEnter, onMouseLeave}}
}

/**
 * React component for rendering the long text content
 */
function LongTextComponent({fullValue, nodeKey}: {fullValue: string; nodeKey: string}) {
    useLexicalComposerContext() // Ensure we're in a Lexical context
    const {enabled: drillInEnabled, decodeEscapedJsonStrings} = useDrillInContext()
    const [copied, setCopied] = useState(false)
    const [expanded, setExpanded] = useState(false)
    // antd `mouseEnterDelay={0.3}` / `mouseLeaveDelay={0.2}`.
    const {open: popoverOpen, setOpen: setPopoverOpen, hoverProps} = useHoverOpen(300, 200)
    const parsed = useMemo(
        () =>
            parseLongTextString(
                `"${decodeEscapedJsonStrings ? decodeEscapedJsonString(fullValue) : fullValue}"`,
            ),
        [fullValue, decodeEscapedJsonStrings],
    )
    const spanRef = React.useRef<HTMLSpanElement>(null)

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(parsed.fullValue)
            setCopied(true)
            message.success("Copied to clipboard")
            setTimeout(() => setCopied(false), 2000)
        } catch {
            message.error("Failed to copy")
        }
    }, [parsed.fullValue])

    const handleCollapse = useCallback(() => {
        setExpanded(false)
        setPopoverOpen(false)
    }, [setPopoverOpen])

    const handleExpand = useCallback(() => {
        setExpanded(true)
        setPopoverOpen(false)
    }, [setPopoverOpen])

    const handleDrillIn = useCallback(() => {
        // console.log("[LongTextNode] handleDrillIn called")
        // console.log("[LongTextNode] spanRef.current:", spanRef.current)
        // Use the ref to find the property key on the same line and dispatch a custom event
        if (spanRef.current) {
            // The class is "editor-code-line", not "code-line"
            const line = spanRef.current.closest(".editor-code-line")
            // console.log("[LongTextNode] Found line:", line)
            if (line) {
                const propertyKey = line.querySelector(".token-property") as HTMLElement
                // console.log("[LongTextNode] Found propertyKey:", propertyKey)
                if (propertyKey) {
                    // Dispatch a custom event with the property element as detail
                    // This will be caught by PropertyClickPlugin
                    const event = new CustomEvent("longtext-drill-in", {
                        bubbles: true,
                        detail: {propertyElement: propertyKey},
                    })
                    // console.log("[LongTextNode] Dispatching event:", event)
                    spanRef.current.dispatchEvent(event)
                } else {
                    // console.log("[LongTextNode] No property key found on line")
                }
            } else {
                // console.log("[LongTextNode] No .editor-code-line parent found")
            }
        } else {
            // console.log("[LongTextNode] spanRef.current is null")
        }
    }, [])

    const handleCollapsedKeyDown = useCallback(
        (event: KeyboardEvent<HTMLSpanElement>) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return
            }

            event.preventDefault()
            handleExpand()
        },
        [handleExpand],
    )

    const handleExpandedKeyDown = useCallback(
        (event: KeyboardEvent<HTMLSpanElement>) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return
            }

            event.preventDefault()
            handleCollapse()
        },
        [handleCollapse],
    )

    const actionLabel = !drillInEnabled && expanded ? "Collapse" : "Expand"

    const handleAction = useCallback(() => {
        if (drillInEnabled) {
            handleDrillIn()
            return
        }

        if (expanded) {
            handleCollapse()
            return
        }

        handleExpand()
    }, [drillInEnabled, expanded, handleCollapse, handleDrillIn, handleExpand])

    // Shared hover popover content
    const popoverContent = (
        <div className="max-w-[500px]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 mb-3">
                <div className="flex items-center gap-2">
                    <TextAlignLeft size={16} className="text-gray-500" />
                    <span className="font-semibold">Long Text</span>
                    <span className="text-xs text-colorTextDescription">
                        ({formatCharCount(parsed.charCount)})
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                        {copied ? "Copied!" : "Copy"}
                    </Button>
                    {drillInEnabled ? (
                        <Button size="sm" variant="default" onClick={handleAction}>
                            {<ArrowSquareOut size={14} />}
                            Drill In
                        </Button>
                    ) : (
                        <Button size="sm" variant="default" onClick={handleAction}>
                            {actionLabel}
                        </Button>
                    )}
                </div>
            </div>

            {/* Full Text Content */}
            <div className="bg-gray-50 rounded-lg p-3 max-h-[300px] overflow-y-auto">
                <span className="text-xs whitespace-pre-wrap break-words font-mono">
                    {parsed.fullValue}
                </span>
            </div>
        </div>
    )

    // When expanded, show the full text inline while preserving a clear interactive state.
    if (expanded) {
        return (
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                {/* Anchor (not Trigger): the popover is hover-driven, so the span keeps its own
                    click-to-collapse semantics instead of Radix's click-to-toggle. */}
                <PopoverAnchor asChild>
                    <span
                        className="inline-flex items-start gap-1 cursor-pointer rounded border border-dashed border-blue-300 bg-blue-50/40 px-1 py-[1px] hover:border-blue-400 hover:bg-blue-50/60 transition-colors"
                        onClick={handleCollapse}
                        role="button"
                        tabIndex={0}
                        aria-expanded
                        onKeyDown={handleExpandedKeyDown}
                        title="Click to collapse"
                        {...hoverProps}
                    >
                        <span className="text-[12px] text-blue-500 mt-[2px] select-none">[-]</span>
                        <span className="text-[12px] text-blue-500 mt-[2px] shrink-0 select-none">
                            [{formatCharCount(parsed.charCount)}]
                        </span>
                        <span
                            ref={spanRef}
                            className="token token-string whitespace-pre-wrap break-words hover:opacity-80 transition-opacity"
                            data-lexical-longtext="true"
                            data-node-key={nodeKey}
                        >
                            &quot;{parsed.fullValue}&quot;
                        </span>
                    </span>
                </PopoverAnchor>
                <PopoverContent
                    side="top"
                    align="start"
                    className="p-3"
                    // Hover popovers must not pull focus out of the editor.
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    {...hoverProps}
                >
                    {popoverContent}
                </PopoverContent>
            </Popover>
        )
    }

    // Collapsed state with hover actions and click-to-expand
    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            {/* Anchor (not Trigger): the popover is hover-driven, so the span keeps its own
                click-to-expand semantics instead of Radix's click-to-toggle. */}
            <PopoverAnchor asChild>
                <span
                    ref={spanRef}
                    className="token token-string cursor-pointer border-b border-dashed border-blue-400"
                    data-lexical-longtext="true"
                    data-node-key={nodeKey}
                    onClick={handleExpand}
                    onKeyDown={handleCollapsedKeyDown}
                    role="button"
                    tabIndex={0}
                    aria-expanded={false}
                    {...hoverProps}
                >
                    &quot;{parsed.preview}...&quot;
                    <span className="text-[12px] text-blue-500 ml-1">
                        [{formatCharCount(parsed.charCount)}]
                    </span>
                </span>
            </PopoverAnchor>
            <PopoverContent
                side="top"
                align="start"
                className="p-3"
                // Hover popovers must not pull focus out of the editor.
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
                {...hoverProps}
            >
                {popoverContent}
            </PopoverContent>
        </Popover>
    )
}

/**
 * LongTextNode - A decorator node for rendering long text strings
 */
export class LongTextNode extends DecoratorNode<React.ReactElement> {
    __fullValue: string
    __highlightType: string

    static getType(): string {
        return "longtext"
    }

    static clone(node: LongTextNode): LongTextNode {
        return new LongTextNode(node.__fullValue, node.__highlightType, node.__key)
    }

    constructor(fullValue: string, highlightType = "string", key?: NodeKey) {
        super(key)
        this.__fullValue = fullValue
        this.__highlightType = highlightType
    }

    createDOM(_config: EditorConfig): HTMLElement {
        const span = document.createElement("span")
        span.className = "longtext-node-wrapper"
        return span
    }

    updateDOM(): boolean {
        return false
    }

    decorate(): React.ReactElement {
        return <LongTextComponent fullValue={this.__fullValue} nodeKey={this.__key} />
    }

    exportJSON(): SerializedLongTextNode {
        return {
            type: "longtext",
            version: 1,
            fullValue: this.__fullValue,
            highlightType: this.__highlightType,
        }
    }

    static importJSON(json: SerializedLongTextNode): LongTextNode {
        return new LongTextNode(json.fullValue, json.highlightType)
    }

    getTextContent(): string {
        // Return the full value for copy/paste and serialization
        return `"${this.__fullValue}"`
    }

    getFullValue(): string {
        return this.__fullValue
    }
}

/**
 * Helper to create a LongTextNode
 */
export function $createLongTextNode(fullValue: string, highlightType = "string"): LongTextNode {
    return new LongTextNode(fullValue, highlightType)
}

/**
 * Type guard for LongTextNode
 */
export function $isLongTextNode(node: LexicalNode | null | undefined): node is LongTextNode {
    return node instanceof LongTextNode
}
