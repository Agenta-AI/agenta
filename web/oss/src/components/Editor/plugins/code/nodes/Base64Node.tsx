/**
 * Base64Node.tsx
 *
 * A custom Lexical node for rendering base64 strings in a collapsed/truncated view.
 * Shows a preview with file icon and allows viewing/copying the full content on hover.
 */
import React, {useCallback, useMemo, useState} from "react"

import {FileArchive, FilePdf, FileText, Image as ImageIcon} from "@phosphor-icons/react"
import {Popover, Typography, Button, message} from "antd"
import {
    DecoratorNode,
    EditorConfig,
    LexicalNode,
    NodeKey,
    SerializedLexicalNode,
    Spread,
} from "lexical"
import Image from "next/image"

const {Text} = Typography

/** Regex to detect base64 data URLs */
const BASE64_DATA_URL_REGEX = /^"?data:([^;]+);base64,([A-Za-z0-9+/=]{50,})"?$/

/** Regex to detect raw base64 strings (at least 100 chars of base64 content) */
const RAW_BASE64_REGEX = /^"?([A-Za-z0-9+/=]{100,})"?$/

/** Maximum length to show in truncated view */
const TRUNCATE_LENGTH = 50

/**
 * Check if a string is a base64 value that should be collapsed
 */
export function isBase64String(value: string): boolean {
    return BASE64_DATA_URL_REGEX.test(value) || RAW_BASE64_REGEX.test(value)
}

/**
 * Extract mime type and truncated preview from base64 string
 */
export function parseBase64String(value: string): {
    mimeType: string | null
    preview: string
    fullValue: string
    isDataUrl: boolean
} {
    const dataUrlMatch = value.match(BASE64_DATA_URL_REGEX)
    if (dataUrlMatch) {
        const mimeType = dataUrlMatch[1]
        const base64Content = dataUrlMatch[2]
        const prefix = `data:${mimeType};base64,`
        const truncatedBase64 = base64Content.substring(0, TRUNCATE_LENGTH)
        return {
            mimeType,
            preview: `${prefix}${truncatedBase64}...[truncated]`,
            fullValue: value.replace(/^"|"$/g, ""),
            isDataUrl: true,
        }
    }

    const rawMatch = value.match(RAW_BASE64_REGEX)
    if (rawMatch) {
        const base64Content = rawMatch[1]
        const truncated = base64Content.substring(0, TRUNCATE_LENGTH)
        return {
            mimeType: null,
            preview: `${truncated}...[truncated]`,
            fullValue: value.replace(/^"|"$/g, ""),
            isDataUrl: false,
        }
    }

    return {
        mimeType: null,
        preview: value,
        fullValue: value,
        isDataUrl: false,
    }
}

/**
 * Get file type label from mime type
 */
function getFileTypeLabel(mimeType: string | null): string {
    if (!mimeType) return "Base64 Data"

    if (mimeType.startsWith("image/")) {
        return `Image (${mimeType.split("/")[1].toUpperCase()})`
    }
    if (mimeType.startsWith("application/pdf")) {
        return "PDF Document"
    }
    if (mimeType.startsWith("application/")) {
        return mimeType.split("/")[1].toUpperCase()
    }
    if (mimeType.startsWith("text/")) {
        return `Text (${mimeType.split("/")[1]})`
    }
    return mimeType
}

/**
 * Serialized form of Base64Node
 */
export type SerializedBase64Node = Spread<
    {
        fullValue: string
        mimeType: string | null
        highlightType: string
    },
    SerializedLexicalNode
>

/**
 * Get the appropriate icon for a mime type
 */
function FileTypeIcon({mimeType, size = 48}: {mimeType: string | null; size?: number}) {
    if (!mimeType) return <FileArchive size={size} className="text-gray-400" />

    if (mimeType.startsWith("image/")) {
        return <ImageIcon size={size} className="text-blue-500" />
    }
    if (mimeType === "application/pdf") {
        return <FilePdf size={size} className="text-red-500" />
    }
    if (mimeType.startsWith("text/")) {
        return <FileText size={size} className="text-green-500" />
    }
    return <FileArchive size={size} className="text-gray-400" />
}

/**
 * React component for rendering the base64 content
 */
function Base64Component({
    fullValue,
    mimeType,
    nodeKey,
}: {
    fullValue: string
    mimeType: string | null
    nodeKey: string
}) {
    const [copied, setCopied] = useState(false)
    const parsed = parseBase64String(fullValue)
    const fileTypeLabel = getFileTypeLabel(mimeType)
    const isImage = mimeType?.startsWith("image/")

    // Build the full data URL for image preview
    const dataUrl = useMemo(() => {
        if (parsed.isDataUrl) {
            // Reconstruct full data URL
            return `data:${mimeType};base64,${parsed.fullValue.replace(/^data:[^;]+;base64,/, "")}`
        }
        return null
    }, [parsed, mimeType])

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

    const isPdf = mimeType === "application/pdf"

    const popoverContent = (
        <div className="max-w-[400px]">
            <div className="flex items-center justify-between gap-4 mb-3">
                <Text strong>{fileTypeLabel}</Text>
                <Button size="small" onClick={handleCopy}>
                    {copied ? "Copied!" : "Copy"}
                </Button>
            </div>

            {/* File Preview */}
            <div className="flex items-center justify-center bg-gray-50 rounded-lg overflow-hidden">
                {isImage && dataUrl ? (
                    <Image
                        src={dataUrl}
                        alt="Preview"
                        width={400}
                        height={250}
                        sizes="(max-width: 640px) 100vw, 400px"
                        className="max-w-full max-h-[250px] rounded object-contain"
                        unoptimized
                    />
                ) : isPdf && dataUrl ? (
                    <iframe
                        src={dataUrl}
                        title="PDF Preview"
                        className="w-full h-[300px] border-0"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-2 p-6">
                        <FileTypeIcon mimeType={mimeType} size={48} />
                        <Text type="secondary" className="text-xs">
                            {fileTypeLabel}
                        </Text>
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <Popover content={popoverContent} title={null} trigger="hover" placement="bottom">
            <span
                className="token token-string cursor-help border-b border-dashed border-gray-400"
                data-lexical-base64="true"
                data-node-key={nodeKey}
            >
                &quot;{parsed.preview}&quot;
            </span>
        </Popover>
    )
}

/**
 * Base64Node - A decorator node for rendering base64 strings
 */
export class Base64Node extends DecoratorNode<React.ReactElement> {
    __fullValue: string
    __mimeType: string | null
    __highlightType: string

    static getType(): string {
        return "base64"
    }

    static clone(node: Base64Node): Base64Node {
        return new Base64Node(node.__fullValue, node.__mimeType, node.__highlightType, node.__key)
    }

    constructor(
        fullValue: string,
        mimeType: string | null,
        highlightType = "string",
        key?: NodeKey,
    ) {
        super(key)
        this.__fullValue = fullValue
        this.__mimeType = mimeType
        this.__highlightType = highlightType
    }

    createDOM(config: EditorConfig): HTMLElement {
        const span = document.createElement("span")
        span.className = "base64-node-wrapper"
        return span
    }

    updateDOM(): boolean {
        return false
    }

    decorate(): React.ReactElement {
        return (
            <Base64Component
                fullValue={this.__fullValue}
                mimeType={this.__mimeType}
                nodeKey={this.__key}
            />
        )
    }

    exportJSON(): SerializedBase64Node {
        return {
            type: "base64",
            version: 1,
            fullValue: this.__fullValue,
            mimeType: this.__mimeType,
            highlightType: this.__highlightType,
        }
    }

    static importJSON(json: SerializedBase64Node): Base64Node {
        return new Base64Node(json.fullValue, json.mimeType, json.highlightType)
    }

    getTextContent(): string {
        // Return the full value for copy/paste and serialization
        return `"${this.__fullValue}"`
    }

    getFullValue(): string {
        return this.__fullValue
    }

    getMimeType(): string | null {
        return this.__mimeType
    }
}

/**
 * Helper to create a Base64Node
 */
export function $createBase64Node(
    fullValue: string,
    mimeType: string | null,
    highlightType = "string",
): Base64Node {
    return new Base64Node(fullValue, mimeType, highlightType)
}

/**
 * Type guard for Base64Node
 */
export function $isBase64Node(node: LexicalNode | null | undefined): node is Base64Node {
    return node instanceof Base64Node
}
