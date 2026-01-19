/**
 * FieldHeader
 *
 * A header component for text fields with copy and markdown toggle functionality.
 * Used in table cells, form fields, and drill-in views.
 *
 * @example
 * ```tsx
 * <FieldHeader
 *   id="field-123"
 *   value="Some text content"
 *   hideMarkdownToggle={false}
 * />
 * ```
 */

import {memo, useCallback, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {Check, Copy, MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtom} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "../../../Editor/plugins/markdown/commands"
import {markdownViewAtom} from "../../../Editor/state/assets/atoms"
import {copyToClipboard} from "../../../utils/copyToClipboard"

export interface FieldHeaderProps {
    /** Unique identifier for the field, used for markdown state tracking */
    id: string
    /** The text value to copy when clicking the copy button */
    value?: string
    /** Whether to hide the markdown toggle button (default: false) */
    hideMarkdownToggle?: boolean
}

/**
 * Field header with copy and markdown toggle buttons.
 *
 * Features:
 * - Copy button with visual feedback
 * - Markdown/text preview toggle (optional)
 * - Integrates with Lexical editor context
 */
const FieldHeader = ({id, value = "", hideMarkdownToggle = false}: FieldHeaderProps) => {
    const [editor] = useLexicalComposerContext()
    const [markdownView] = useAtom(markdownViewAtom(id))
    const [isCopied, setIsCopied] = useState(false)

    const onCopyText = useCallback(async () => {
        if (value) {
            const success = await copyToClipboard(value)
            if (success) {
                setIsCopied(true)
                setTimeout(() => {
                    setIsCopied(false)
                }, 1000)
            }
        }
    }, [value])

    const onToggleMarkdown = useCallback(() => {
        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
    }, [editor])

    return (
        <div className="flex items-center justify-end gap-1 w-full">
            <Tooltip title={isCopied ? "Copied" : "Copy"}>
                <Button
                    type="text"
                    size="small"
                    icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={onCopyText}
                    className="flex items-center justify-center"
                />
            </Tooltip>

            {!hideMarkdownToggle && (
                <Tooltip title={markdownView ? "Preview text" : "Preview markdown"}>
                    <Button
                        type="text"
                        size="small"
                        icon={markdownView ? <TextAa size={14} /> : <MarkdownLogoIcon size={14} />}
                        onClick={onToggleMarkdown}
                        className="flex items-center justify-center"
                    />
                </Tooltip>
            )}
        </div>
    )
}

export default memo(FieldHeader)
