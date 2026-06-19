import {memo, useMemo} from "react"

import {Typography} from "antd"

import {useRowHeightContext} from "../InfiniteVirtualTable/context/RowHeightContext"

import CellContentPopover from "./CellContentPopover"
import ChatMessagesCellContent from "./ChatMessagesCellContent"
import {extractPreview} from "./extractPreview"
import JsonCellContent from "./JsonCellContent"
import TextCellContent from "./TextCellContent"
import {
    normalizeValue,
    safeJsonStringify,
    type ChatExtractionPreference,
    type ChatPreviewStrategy,
} from "./utils"

const {Text} = Typography

interface SmartCellContentProps {
    /** Value to render - auto-detects type */
    value: unknown
    /** Unique key prefix for React keys (used for chat messages) */
    keyPrefix?: string
    /**
     * Max lines to show in cell preview.
     * If not provided, uses the value from RowHeightContext (set by IVT's rowHeightConfig).
     * Falls back to 10 if neither is available.
     */
    maxLines?: number
    /** CSS class for the container */
    className?: string
    /** Whether to show popover on hover */
    showPopover?: boolean
    /**
     * Side hint for the chat rule. Disambiguates payloads that carry both
     * input-side and output-side chat keys in the same blob (see
     * `extractChatMessages` prefer ordering).
     */
    chatPreference?: ChatExtractionPreference
    /** Strategy for selecting chat messages in the truncated cell preview */
    chatPreviewStrategy?: ChatPreviewStrategy
    /**
     * Force the JSON fallback path to use the pretty key/value renderer
     * instead of raw JSON text. The dispatcher's pretty renderer is
     * separate and is driven by rule matches; this prop only affects the
     * fallback when no rule matches.
     */
    prettyJson?: boolean
}

/**
 * Smart cell content renderer.
 *
 * Delegates the "what to render" decision to `extractPreview`, which returns a
 * discriminated union of renderer + data + source. The cell then switches on
 * the renderer.
 *
 * Features:
 * - Auto-dispatch via extractPreview (chat, pretty, json)
 * - Truncation for cell preview
 * - Full content in popover on hover
 * - Copy functionality in popover
 */
const SmartCellContent = memo(
    ({
        value,
        keyPrefix = "cell",
        maxLines: maxLinesProp,
        className = "",
        showPopover = true,
        chatPreference,
        chatPreviewStrategy,
        prettyJson = false,
    }: SmartCellContentProps) => {
        const rowHeightContext = useRowHeightContext()
        const maxLines = maxLinesProp ?? rowHeightContext.maxLines

        const preview = useMemo(
            () => extractPreview(value, chatPreference),
            [value, chatPreference],
        )

        const displayValue = useMemo(() => normalizeValue(value), [value])

        if (value === undefined || value === null || value === "") {
            return (
                <div className={`${className}`}>
                    <Text type="secondary" className="text-xs">
                        —
                    </Text>
                </div>
            )
        }

        if (preview.renderer === "chat") {
            const copyText = safeJsonStringify(preview.data)
            const cellContent = (
                <div className={`cursor-pointer ${className}`}>
                    <ChatMessagesCellContent
                        value={preview.data}
                        keyPrefix={keyPrefix}
                        previewStrategy={chatPreviewStrategy}
                        maxLines={4}
                        maxTotalLines={maxLines}
                        truncate
                    />
                </div>
            )

            if (!showPopover) return cellContent

            return (
                <CellContentPopover
                    fullContent={
                        <ChatMessagesCellContent
                            value={preview.data}
                            keyPrefix={`${keyPrefix}-popover`}
                            truncate={false}
                        />
                    }
                    copyText={copyText}
                >
                    {cellContent}
                </CellContentPopover>
            )
        }

        if (preview.renderer === "pretty") {
            const copyText = safeJsonStringify(preview.data)
            const cellContent = (
                <div className={`cursor-pointer ${className}`}>
                    <JsonCellContent value={preview.data} maxLines={maxLines} truncate pretty />
                </div>
            )

            if (!showPopover) return cellContent

            return (
                <CellContentPopover
                    fullContent={<JsonCellContent value={preview.data} truncate={false} pretty />}
                    copyText={copyText}
                >
                    {cellContent}
                </CellContentPopover>
            )
        }

        // preview.renderer === "json": raw JSON / text fallback
        const jsonCandidate = preview.data
        const isObjectLike = typeof jsonCandidate === "object" && jsonCandidate !== null
        const copyText = isObjectLike ? safeJsonStringify(jsonCandidate) : displayValue

        if (isObjectLike) {
            const cellContent = (
                <div className={`cursor-pointer ${className}`}>
                    <JsonCellContent
                        value={jsonCandidate}
                        maxLines={maxLines}
                        truncate
                        pretty={prettyJson}
                    />
                </div>
            )

            if (!showPopover) return cellContent

            return (
                <CellContentPopover
                    fullContent={
                        <JsonCellContent
                            value={jsonCandidate}
                            truncate={false}
                            pretty={prettyJson}
                        />
                    }
                    copyText={copyText}
                >
                    {cellContent}
                </CellContentPopover>
            )
        }

        const cellContent = (
            <div className={`cursor-pointer ${className}`}>
                <TextCellContent value={displayValue} maxLines={maxLines} truncate />
            </div>
        )

        if (!showPopover) return cellContent

        return (
            <CellContentPopover
                fullContent={<TextCellContent value={displayValue} truncate={false} />}
                copyText={copyText}
            >
                {cellContent}
            </CellContentPopover>
        )
    },
)
SmartCellContent.displayName = "SmartCellContent"

export default SmartCellContent
