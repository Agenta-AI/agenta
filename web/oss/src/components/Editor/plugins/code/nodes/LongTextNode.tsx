/**
 * LongTextNode.tsx
 *
 * A custom Lexical node for rendering long text strings in a collapsed/truncated view.
 * Shows a preview with character count and allows viewing the full content via drill-in.
 */
import React, {useCallback, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {TextAlignLeft, ArrowSquareOut} from "@phosphor-icons/react"
import {Popover, Typography, Button, message} from "antd"
import {
    DecoratorNode,
    EditorConfig,
    LexicalNode,
    NodeKey,
    SerializedLexicalNode,
    Spread,
} from "lexical"

const {Text} = Typography

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
 * React component for rendering the long text content
 */
function LongTextComponent({fullValue, nodeKey}: {fullValue: string; nodeKey: string}) {
    useLexicalComposerContext() // Ensure we're in a Lexical context
    const [copied, setCopied] = useState(false)
    const parsed = parseLongTextString(`"${fullValue}"`)
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

    const handleDrillIn = useCallback(() => {
        console.log("[LongTextNode] handleDrillIn called")
        console.log("[LongTextNode] spanRef.current:", spanRef.current)
        // Use the ref to find the property key on the same line and dispatch a custom event
        if (spanRef.current) {
            // The class is "editor-code-line", not "code-line"
            const line = spanRef.current.closest(".editor-code-line")
            console.log("[LongTextNode] Found line:", line)
            if (line) {
                const propertyKey = line.querySelector(".token-property") as HTMLElement
                console.log("[LongTextNode] Found propertyKey:", propertyKey)
                if (propertyKey) {
                    // Dispatch a custom event with the property element as detail
                    // This will be caught by PropertyClickPlugin
                    const event = new CustomEvent("longtext-drill-in", {
                        bubbles: true,
                        detail: {propertyElement: propertyKey},
                    })
                    console.log("[LongTextNode] Dispatching event:", event)
                    spanRef.current.dispatchEvent(event)
                } else {
                    console.log("[LongTextNode] No property key found on line")
                }
            } else {
                console.log("[LongTextNode] No .editor-code-line parent found")
            }
        } else {
            console.log("[LongTextNode] spanRef.current is null")
        }
    }, [])

    const popoverContent = (
        <div className="max-w-[500px]">
            <div className="flex items-center justify-between gap-4 mb-3">
                <div className="flex items-center gap-2">
                    <TextAlignLeft size={16} className="text-gray-500" />
                    <Text strong>Long Text</Text>
                    <Text type="secondary" className="text-xs">
                        ({formatCharCount(parsed.charCount)})
                    </Text>
                </div>
                <div className="flex items-center gap-2">
                    <Button size="small" onClick={handleCopy}>
                        {copied ? "Copied!" : "Copy"}
                    </Button>
                    <Button
                        size="small"
                        type="primary"
                        icon={<ArrowSquareOut size={14} />}
                        onClick={handleDrillIn}
                    >
                        Drill In
                    </Button>
                </div>
            </div>

            {/* Full Text Content */}
            <div className="bg-gray-50 rounded-lg p-3 max-h-[300px] overflow-y-auto">
                <Text className="text-xs whitespace-pre-wrap break-words font-mono">
                    {parsed.fullValue}
                </Text>
            </div>
        </div>
    )

    return (
        <Popover content={popoverContent} title={null} trigger="hover" placement="bottom">
            <span
                ref={spanRef}
                className="token token-string cursor-help border-b border-dashed border-blue-400"
                data-lexical-longtext="true"
                data-node-key={nodeKey}
            >
                &quot;{parsed.preview}...&quot;
                <span className="text-[10px] text-blue-500 ml-1">
                    [{formatCharCount(parsed.charCount)}]
                </span>
            </span>
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
